'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');

/**
 * El draft entero por la API, como lo haría la web: administración configura e
 * inicia, cuatro capitanes eligen por turnos desde su sesión, y un observador
 * conectado al canal en directo recibe los avisos.
 */
describe('draft completo de punta a punta', () => {
  const directories = [];
  const bases = [];
  const servers = [];
  const ADMIN = 'token-de-pruebas';

  afterEach(() => {
    servers.splice(0).forEach((s) => { try { s.close(); } catch { /* ya cerrado */ } });
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directories.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  /** Discord de mentira: la identidad sale del código que se le pasa. */
  const discordFalso = {
    configured: true,
    describe: () => ({ configured: true, scope: 'identify', redirectUri: 'http://x/cb' }),
    authorizeUrl: (state) => `https://discord.test/a?state=${state}`,
    exchange: async (code) => ({
      discordUserId: String(code), username: `u${code}`, displayName: `Capitán ${code}`
    })
  };

  function montar() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-e2e-draft-'));
    directories.push(directory);
    const database = openDatabase(path.join(directory, 'tournament.db'));
    bases.push(database);
    const app = createApp({ database, adminToken: ADMIN, discord: discordFalso });
    const event = database.createEvent({
      slug: 'torneo-valorant', name: 'Torneo Valorant', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { draft: true },
      accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/x.png'
    });
    return { database, app, event };
  }

  async function sesionDeCapitan(app, database, event, participantId, discordUserId) {
    const inicio = await request(app).get('/auth/discord').expect(302);
    const state = new URL(inicio.headers.location).searchParams.get('state');
    const nonce = inicio.headers['set-cookie'][0].split(';')[0];
    const callback = await request(app).get('/auth/discord/callback')
      .set('Cookie', nonce).query({ code: String(discordUserId), state }).expect(302);
    const cookie = callback.headers['set-cookie']
      .find((c) => c.startsWith('jarti_session=')).split(';')[0];

    const cuenta = database.valorant.getDiscordAccountByUserId(String(discordUserId));
    database.valorant.linkParticipantToDiscord(participantId, cuenta.id);
    return cookie;
  }

  const admin = (app, metodo, ruta, cuerpo) => request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${ADMIN}`).send(cuerpo);

  const elegir = (app, slug, cookie, selectedParticipantId) => request(app)
    .post(`/api/events/${slug}/draft/pick`)
    .set('Cookie', cookie)
    .send({ selectedParticipantId });

  it('20 inscritos, 16 elecciones en serpiente, cuatro equipos de cinco', async () => {
    const { database, app, event } = montar();

    // --- 20 confirmados -------------------------------------------------
    const gente = [];
    for (let i = 1; i <= 20; i++) {
      const creado = database.createParticipant(event.id, {
        discord_username: `p${i}#d`, game_name: `Jugador ${String(i).padStart(2, '0')}`
      });
      gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
    }
    const capitanes = gente.slice(0, 4).map((p) => p.id);
    const elegibles = gente.slice(4).map((p) => p.id);

    // --- cuatro capitanes con su cuenta de Discord ----------------------
    const cookies = [];
    for (let i = 0; i < 4; i++) {
      cookies.push(await sesionDeCapitan(app, database, event, capitanes[i], 900 + i));
    }
    const cookieJugador = await sesionDeCapitan(app, database, event, gente[10].id, 999);

    // --- observador del canal en directo --------------------------------
    const recibidos = [];
    const server = app.listen(0);
    servers.push(server);
    const puerto = server.address().port;

    await new Promise((resolve) => {
      const peticion = http.get(
        { port: puerto, path: `/api/events/${event.slug}/draft/stream` },
        (respuesta) => {
          assert.equal(respuesta.statusCode, 200);
          respuesta.setEncoding('utf8');
          respuesta.on('data', (trozo) => {
            for (const linea of trozo.split('\n')) {
              if (linea.startsWith('event: ')) recibidos.push(linea.slice(7).trim());
            }
          });
          resolve();
        });
      peticion.on('error', resolve);
      servers.push({ close: () => peticion.destroy() });
    });

    const esperarAviso = async (tipo) => {
      for (let intento = 0; intento < 40 && !recibidos.includes(tipo); intento++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(recibidos.includes(tipo), `no llegó el aviso ${tipo}. Recibidos: ${recibidos.join(', ')}`);
    };

    await esperarAviso('connected');

    // --- administración configura e inicia ------------------------------
    await admin(app, 'put', `/api/admin/events/${event.id}/draft`,
      { captains: capitanes, teamCount: 4, teamSize: 5 }).expect(200);
    await admin(app, 'post', `/api/admin/events/${event.id}/draft/start`, {}).expect(200);
    await esperarAviso('draft_started');

    // --- permisos antes de la primera elección --------------------------
    const normal = await elegir(app, event.slug, cookieJugador, elegibles[0]);
    assert.equal(normal.status, 409, 'un participante normal no elige');
    assert.equal(normal.body.error.code, 'NOT_YOUR_TURN');

    const fueraDeTurno = await elegir(app, event.slug, cookies[1], elegibles[0]);
    assert.equal(fueraDeTurno.status, 409, 'el capitán 2 no puede adelantarse');

    const anonimo = await request(app).post(`/api/events/${event.slug}/draft/pick`)
      .send({ selectedParticipantId: elegibles[0] });
    assert.equal(anonimo.status, 401);

    // --- las 16 elecciones, en orden serpiente --------------------------
    const orden = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3, 3, 2, 1, 0];
    let pausaHecha = false;

    for (let i = 0; i < 16; i++) {
      // A mitad, administración pausa y comprueba que nadie puede elegir.
      if (i === 6 && !pausaHecha) {
        pausaHecha = true;
        const antes = (await request(app).get(`/api/events/${event.slug}/draft`).expect(200)).body;

        await admin(app, 'post', `/api/admin/events/${event.id}/draft/status`,
          { status: 'PAUSED', reason: 'incidencia' }).expect(200);
        await esperarAviso('draft_paused');

        const durante = await elegir(app, event.slug, cookies[orden[i]], elegibles[i]);
        assert.equal(durante.status, 409, 'en pausa no elige nadie');

        await admin(app, 'post', `/api/admin/events/${event.id}/draft/status`,
          { status: 'ACTIVE' }).expect(200);
        await esperarAviso('draft_resumed');

        const despues = (await request(app).get(`/api/events/${event.slug}/draft`).expect(200)).body;
        assert.equal(despues.pick, antes.pick, 'la pausa conserva la elección');
        assert.equal(despues.round, antes.round, 'y la ronda');
        assert.equal(despues.currentTeamId, antes.currentTeamId, 'y el turno');
      }

      const respuesta = await elegir(app, event.slug, cookies[orden[i]], elegibles[i]);
      assert.equal(respuesta.status, 201, `elección ${i + 1} con el capitán ${orden[i] + 1}`);
      assert.equal(respuesta.body.pick.pickNumber, i + 1);

      // Repetir al mismo jugador ya no vale.
      if (i === 0) {
        const repetido = await elegir(app, event.slug, cookies[orden[1]], elegibles[0]);
        assert.equal(repetido.status, 409);
        assert.equal(repetido.body.error.code, 'TARGET_ALREADY_TAKEN');
      }
    }

    await esperarAviso('pick_made');
    await esperarAviso('draft_completed');

    // --- resultado ------------------------------------------------------
    const estado = (await request(app).get(`/api/events/${event.slug}/draft`).expect(200)).body;
    assert.equal(estado.status, 'COMPLETED');
    assert.equal(estado.available.length, 0, 'no queda nadie por elegir');
    assert.equal(estado.picks.length, 16, 'dieciséis elecciones');
    assert.equal(estado.teams.length, 4);

    for (const equipo of estado.teams) {
      assert.equal(equipo.members.length, 5, `${equipo.name} completo`);
      assert.equal(equipo.members.filter((m) => m.role === 'captain').length, 1);
    }

    const todos = estado.teams.flatMap((t) => t.members.map((m) => m.participantId));
    assert.equal(todos.length, 20);
    assert.equal(new Set(todos).size, 20, 'nadie repetido en dos equipos');
    assert.equal(new Set(estado.picks.map((p) => p.participantId)).size, 16);

    // --- ya no se puede elegir -----------------------------------------
    const tarde = await elegir(app, event.slug, cookies[0], gente[19].id);
    assert.equal(tarde.status, 409);

    // --- nombre de equipo ----------------------------------------------
    const renombrar = (cookie, name) => request(app)
      .patch(`/api/events/${event.slug}/my-team`).set('Cookie', cookie).send({ name });

    const mio = await renombrar(cookies[0], 'Los Filtradores').expect(200);
    assert.equal(mio.body.team.name, 'Los Filtradores');
    await esperarAviso('team_updated');

    // El nombre nuevo se ve en el estado público, sin recargar nada.
    const conNombre = (await request(app).get(`/api/events/${event.slug}/draft`).expect(200)).body;
    assert.ok(conNombre.teams.some((t) => t.name === 'Los Filtradores'));

    // Otro capitán no puede robar el nombre, ni renombrar el ajeno.
    const repetido = await renombrar(cookies[1], 'los filtradores');
    assert.equal(repetido.status, 409, 'mismo nombre en minúsculas es el mismo nombre');
    assert.equal(repetido.body.error.code, 'TEAM_NAME_TAKEN');

    // Un participante normal no tiene equipo que renombrar.
    const sinEquipo = await renombrar(cookieJugador, 'Intruso');
    assert.equal(sinEquipo.status, 403);
    assert.equal(sinEquipo.body.error.code, 'NOT_A_CAPTAIN');

    // Nombres imposibles.
    assert.equal((await renombrar(cookies[1], ' ')).status, 400);
    assert.equal((await renombrar(cookies[1], 'x'.repeat(33))).status, 400);

    // Administración sí puede tocar cualquiera.
    const porAdmin = await admin(app, 'post', `/api/admin/events/${event.id}/teams/rename`,
      { teamId: estado.teams[1].id, name: 'Renombrado por la organización', reason: 'nombre ofensivo' })
      .expect(200);
    assert.equal(porAdmin.body.team.name, 'Renombrado por la organización');

    // --- el canal recibió el circuito entero ----------------------------
    for (const aviso of ['connected', 'draft_started', 'pick_made', 'draft_paused',
      'draft_resumed', 'draft_completed', 'team_updated']) {
      assert.ok(recibidos.includes(aviso), `falta el aviso ${aviso}`);
    }

    // --- y nada privado viajó por el canal ------------------------------
    assert.equal(recibidos.some((linea) => /900|999|discord/i.test(linea)), false);
  });
});
