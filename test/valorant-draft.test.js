'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { snakeTurn, totalPicks } = require('../src/valorant-store');

describe('draft de Valorant', () => {
  const directories = [];
  const bases = [];
  const ADMIN = 'token-de-pruebas';

  afterEach(() => {
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directories.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  /** Discord de mentira: en las pruebas no sale una sola peticion de red. */
  function fakeDiscord(identity = { discordUserId: '1', username: 'uno' }) {
    const calls = [];
    return {
      calls,
      configured: true,
      describe: () => ({ configured: true, scope: 'identify', redirectUri: 'http://localhost/cb' }),
      authorizeUrl: (state) => `https://discord.test/authorize?state=${state}`,
      exchange: async (code) => { calls.push(code); return identity; }
    };
  }

  function montar({ discord = fakeDiscord() } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-valorant-'));
    directories.push(directory);
    const database = openDatabase(path.join(directory, 'tournament.db'));
    bases.push(database);
    const app = createApp({ database, adminToken: ADMIN, discord });
    // El evento de Valorant ya existe en la plataforma; aqui se crea igual.
    const event = database.createEvent({
      slug: 'torneo-valorant', name: 'Torneo Valorant', game: 'Valorant',
      description: 'Prueba',
      // El evento real sigue en Próximamente. Aquí se abren las inscripciones
      // porque lo que se prueba es el draft, no la puerta de entrada.
      status: 'Inscripciones abiertas', registrationsOpen: true,
      accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/x.png'
    });
    return { database, app, event, discord };
  }

  /** 20 confirmados, como el torneo real. */
  function inscribir(database, event, cuantos = 20) {
    const gente = [];
    for (let i = 1; i <= cuantos; i++) {
      const creado = database.createParticipant(event.id, {
        discord_username: `jugador${i}#discord`,
        game_name: `Jugador ${String(i).padStart(2, '0')}`
      });
      gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
    }
    return gente;
  }

  /** Deja el draft en marcha y devuelve todo lo necesario. */
  function draftEnMarcha(extra = {}) {
    const contexto = montar(extra);
    const { database, event } = contexto;
    const gente = inscribir(database, event);
    const capitanes = gente.slice(0, 4).map((p) => p.id);
    database.valorant.configureDraft(event.id, { captains: capitanes, teamCount: 4, teamSize: 5 });
    database.valorant.startDraft(event.id);
    return { ...contexto, gente, capitanes };
  }

  /** Login completo: arrastra la cookie temporal como haria un navegador. */
  async function login(app) {
    const inicio = await request(app).get('/auth/discord').expect(302);
    const state = new URL(inicio.headers.location).searchParams.get('state');
    const nonce = inicio.headers['set-cookie'][0].split(';')[0];

    const callback = await request(app).get('/auth/discord/callback')
      .set('Cookie', nonce).query({ code: 'ok', state }).expect(302);
    const cookies = callback.headers['set-cookie'];
    return {
      state,
      nonce,
      cookies,
      sesion: cookies.find((c) => c.startsWith('jarti_session=')).split(';')[0]
    };
  }

  /** Vincula una cuenta de Discord a una inscripcion y devuelve su cookie. */
  function sesionDe(database, event, participantId, discordUserId) {
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: String(discordUserId), username: `u${discordUserId}`
    });
    database.valorant.linkParticipantToDiscord(participantId, cuenta.id);
    return `jarti_session=${database.valorant.createSession(cuenta.id)}`;
  }

  // ============================== SNAKE ==============================

  describe('orden serpiente', () => {
    const ordenDe = (equipos, picks) =>
      Array.from({ length: picks }, (_, i) => snakeTurn(equipos, i + 1).seedIndex + 1);

    it('va y vuelve con cuatro equipos', () => {
      assert.deepEqual(ordenDe(4, 16), [1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4, 4, 3, 2, 1]);
    });

    it('no depende de que sean cuatro', () => {
      assert.deepEqual(ordenDe(3, 9), [1, 2, 3, 3, 2, 1, 1, 2, 3]);
      assert.deepEqual(ordenDe(5, 10), [1, 2, 3, 4, 5, 5, 4, 3, 2, 1]);
    });

    it('cambia de dirección en cada ronda', () => {
      assert.equal(snakeTurn(4, 1).direction, 1);
      assert.equal(snakeTurn(4, 1).round, 1);
      assert.equal(snakeTurn(4, 5).direction, -1);
      assert.equal(snakeTurn(4, 5).round, 2);
      assert.equal(snakeTurn(4, 9).direction, 1);
      assert.equal(snakeTurn(4, 9).round, 3);
    });

    it('calcula las elecciones descontando al capitán', () => {
      assert.equal(totalPicks(4, 5), 16);
      assert.equal(totalPicks(3, 5), 12);
      assert.equal(totalPicks(2, 3), 4);
    });
  });

  // ============================== OAUTH ==============================

  describe('identidad de Discord', () => {
    it('arranca y responde aunque Discord no esté configurado', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-sin-discord-'));
      directories.push(directory);
      const database = openDatabase(path.join(directory, 'tournament.db'));
      bases.push(database);
      // Sin proveedor: es el estado real mientras no haya credenciales.
      const app = createApp({ database, adminToken: ADMIN });

      const estado = await request(app).get('/api/auth/discord/status').expect(200);
      assert.equal(estado.body.configured, false);
      assert.equal(estado.body.redirectUri, null);

      await request(app).get('/auth/discord').expect(503);
      // Y el resto de la plataforma sigue en pie.
      await request(app).get('/api/health').expect(200);
    });

    it('da un state y un nonce distintos cada vez', () => {
      const { database } = montar();
      const uno = database.valorant.createOAuthState();
      const otro = database.valorant.createOAuthState();
      assert.notEqual(uno.state, otro.state);
      assert.notEqual(uno.nonce, otro.nonce);
      assert.ok(uno.state.length >= 32 && uno.nonce.length >= 32);
    });

    it('el state sólo vale una vez y sólo con su nonce', () => {
      const { database } = montar();
      const v = database.valorant;

      const bueno = v.createOAuthState();
      assert.equal(v.consumeOAuthState(bueno.state, 'inventado'), null, 'nonce que no es');
      // Un intento fallido tampoco se puede repetir.
      assert.equal(v.consumeOAuthState(bueno.state, bueno.nonce), null, 'ya quemado');

      const otro = v.createOAuthState();
      assert.ok(v.consumeOAuthState(otro.state, otro.nonce));
      assert.equal(v.consumeOAuthState(otro.state, otro.nonce), null, 'no se reutiliza');
      assert.equal(v.consumeOAuthState('inexistente', 'x'), null);
    });

    it('rechaza un state sin nonce y uno caducado', () => {
      const { database } = montar();
      const v = database.valorant;
      const sinCookie = v.createOAuthState();
      assert.equal(v.consumeOAuthState(sinCookie.state, null), null, 'sin cookie no vale');

      const viejo = v.createOAuthState({ ttlSeconds: -1 });
      assert.equal(v.consumeOAuthState(viejo.state, viejo.nonce), null, 'caducado');
    });

    it('el enlace de Discord no fuerza autorización silenciosa', () => {
      const { createDiscordProvider } = require('../src/services/discord-oauth');
      const provider = createDiscordProvider({
        clientId: 'id', clientSecret: 'secreto', redirectUri: 'https://jarti.test/cb'
      });
      const url = new URL(provider.authorizeUrl('abc'));

      // prompt=none salta la pantalla de autorizacion: el primer acceso de
      // cualquiera se romperia justo al abrir inscripciones.
      assert.equal(url.searchParams.get('prompt'), null);
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.equal(url.searchParams.get('scope'), 'identify');
      assert.equal(url.searchParams.get('state'), 'abc');
      assert.equal(url.searchParams.get('client_secret'), null, 'el secreto no viaja');
    });

    it('crea sesión en el callback y no expone nada de Discord', async () => {
      const { app } = montar({ discord: fakeDiscord({ discordUserId: '9001', username: 'luis', displayName: 'Luis' }) });
      const { cookies, sesion } = await login(app);

      const galleta = cookies.find((c) => c.startsWith('jarti_session='));
      assert.match(galleta, /HttpOnly/);
      assert.match(galleta, /SameSite=Lax/);
      assert.doesNotMatch(galleta, /9001/, 'la cookie no lleva el id de Discord');
      // La cookie temporal se borra al terminar.
      assert.ok(cookies.some((c) => c.startsWith('jarti_oauth=;') || /jarti_oauth=; .*Max-Age=0/.test(c)));

      const yo = await request(app).get('/api/me').set('Cookie', sesion).expect(200);
      assert.equal(yo.body.authenticated, true);
      assert.equal(yo.body.displayName, 'Luis');
      assert.equal(JSON.stringify(yo.body).includes('9001'), false);
    });

    it('no acepta un callback desde otro navegador', async () => {
      const { app } = montar();
      const inicio = await request(app).get('/auth/discord').expect(302);
      const state = new URL(inicio.headers.location).searchParams.get('state');

      // Alguien con el enlace pero sin la cookie del navegador que empezó.
      await request(app).get('/auth/discord/callback').query({ code: 'x', state }).expect(400);

      // Y con la cookie de OTRO intento tampoco.
      const otroIntento = await request(app).get('/auth/discord').expect(302);
      const otroNonce = otroIntento.headers['set-cookie'][0].split(';')[0];
      await request(app).get('/auth/discord/callback')
        .set('Cookie', otroNonce).query({ code: 'x', state }).expect(400);
    });

    it('rechaza un state inventado o ya usado', async () => {
      const { app } = montar();
      await request(app).get('/auth/discord/callback').query({ code: 'x', state: 'falso' }).expect(400);

      const { state, nonce } = await login(app);
      // El mismo enlace reenviado, con su cookie y todo, no vale otra vez.
      await request(app).get('/auth/discord/callback')
        .set('Cookie', nonce).query({ code: 'x', state }).expect(400);
    });

    it('cierra la sesión de verdad', async () => {
      const { app } = montar();
      const { sesion } = await login(app);
      await request(app).post('/api/auth/logout').set('Cookie', sesion).expect(200);
      const despues = await request(app).get('/api/me').set('Cookie', sesion).expect(200);
      assert.equal(despues.body.authenticated, false);
    });

    it('en la base sólo queda la huella de la sesión', () => {
      const { database } = montar();
      const cuenta = database.valorant.upsertDiscordAccount({ discordUserId: '42', username: 'x' });
      const token = database.valorant.createSession(cuenta.id);

      // Leer la tabla no entrega sesiones utilizables.
      const guardado = database.valorant.getSession(token);
      assert.ok(guardado);
      assert.equal(JSON.stringify(guardado).includes(token), false);
      assert.equal(database.valorant.getSession('otro-token'), null);
    });

    it('no deja dos inscripciones de la misma cuenta en un evento', () => {
      const { database, event } = montar();
      const gente = inscribir(database, event, 2);
      const cuenta = database.valorant.upsertDiscordAccount({ discordUserId: '5', username: 'cinco' });
      database.valorant.linkParticipantToDiscord(gente[0].id, cuenta.id);
      assert.throws(() => database.valorant.linkParticipantToDiscord(gente[1].id, cuenta.id),
        (error) => error.code === 'DISCORD_ALREADY_REGISTERED');
    });
  });

  // ============================ CONFIGURAR ============================

  describe('preparar el draft', () => {
    it('exige exactamente los capitanes configurados, distintos y confirmados', () => {
      const { database, event } = montar();
      const gente = inscribir(database, event);
      const v = database.valorant;

      assert.throws(() => v.configureDraft(event.id, { captains: gente.slice(0, 3).map((p) => p.id), teamCount: 4, teamSize: 5 }),
        (e) => e.code === 'CAPTAIN_COUNT_MISMATCH');
      assert.throws(() => v.configureDraft(event.id, { captains: [gente[0].id, gente[0].id, gente[1].id, gente[2].id], teamCount: 4, teamSize: 5 }),
        (e) => e.code === 'DUPLICATE_CAPTAIN');

      const pendiente = database.createParticipant(event.id, { discord_username: 'p#d', game_name: 'Pendiente' });
      assert.throws(() => v.configureDraft(event.id, { captains: [gente[0].id, gente[1].id, gente[2].id, pendiente.id], teamCount: 4, teamSize: 5 }),
        (e) => e.code === 'CAPTAIN_NOT_CONFIRMED');
    });

    it('rechaza un capitán de otro evento', () => {
      const { database, event } = montar();
      const gente = inscribir(database, event);
      const otro = database.getDefaultEvent();
      const ajeno = database.createParticipant(otro.id, {
        discord_username: 'ajeno#d', game_name: 'Ajeno', friend_code: 'ajeno#1234'
      });
      database.updateParticipant(ajeno.id, { status: 'confirmed' });

      assert.throws(() => database.valorant.configureDraft(event.id, {
        captains: [gente[0].id, gente[1].id, gente[2].id, ajeno.id], teamCount: 4, teamSize: 5
      }), (e) => e.code === 'CAPTAIN_EVENT_MISMATCH');
    });

    it('crea los equipos con su capitán dentro y deja el draft pendiente', () => {
      const { database, event } = montar();
      const gente = inscribir(database, event);
      const draft = database.valorant.configureDraft(event.id, {
        captains: gente.slice(0, 4).map((p) => p.id), teamCount: 4, teamSize: 5
      });

      assert.equal(draft.status, 'PENDING');
      assert.equal(draft.totalPicks, 16);
      const equipos = database.valorant.listTeams(event.id);
      assert.equal(equipos.length, 4);
      for (const equipo of equipos) {
        assert.equal(equipo.members.length, 1);
        assert.equal(equipo.members[0].role, 'captain');
        assert.equal(equipo.members[0].participantId, equipo.captainParticipantId);
      }
      // Los capitanes ya no estan disponibles para ser elegidos.
      assert.equal(database.valorant.listAvailableParticipants(event.id).length, 16);
    });
  });

  // ============================== INICIAR ==============================

  describe('iniciar', () => {
    it('exige la plantilla exacta: ni uno de menos ni uno de más', () => {
      // Con "al menos los necesarios", un inscrito de sobra se quedaría fuera
      // al acabar el draft sin que nadie lo hubiera decidido.
      const prueba = (cuantos) => {
        const { database, event } = montar();
        const gente = inscribir(database, event, cuantos);
        database.valorant.configureDraft(event.id, {
          captains: gente.slice(0, 4).map((p) => p.id), teamCount: 4, teamSize: 5
        });
        try {
          database.valorant.startDraft(event.id);
          return { arranca: true, estado: database.valorant.getDraft(event.id).status };
        } catch (error) {
          return { arranca: false, code: error.code, estado: database.valorant.getDraft(event.id).status };
        }
      };

      const diecinueve = prueba(19);
      assert.equal(diecinueve.arranca, false);
      assert.equal(diecinueve.code, 'ROSTER_SIZE_MISMATCH');
      assert.equal(diecinueve.estado, 'PENDING', 'un fallo no muta el draft');

      const veinte = prueba(20);
      assert.equal(veinte.arranca, true);
      assert.equal(veinte.estado, 'ACTIVE');

      const veintiuno = prueba(21);
      assert.equal(veintiuno.arranca, false);
      assert.equal(veintiuno.code, 'ROSTER_SIZE_MISMATCH');
      assert.equal(veintiuno.estado, 'PENDING');
    });

    it('arranca en la primera elección del primer capitán', () => {
      const { database, event, capitanes } = draftEnMarcha();
      const draft = database.valorant.getDraft(event.id);
      assert.equal(draft.status, 'ACTIVE');
      assert.equal(draft.currentPick, 1);
      assert.equal(draft.currentRound, 1);
      const turno = database.valorant.teamForPick(event.id, 1);
      assert.equal(turno.team.captainParticipantId, capitanes[0]);
    });
  });

  // =============================== PICKS ===============================

  describe('elegir', () => {
    it('sólo puede el capitán al que le toca', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const disponible = gente[4].id;

      // El segundo capitan no puede adelantarse.
      assert.throws(() => database.valorant.pick(event.id, {
        captainParticipantId: capitanes[1], selectedParticipantId: disponible
      }), (e) => e.code === 'NOT_YOUR_TURN');

      // Un jugador normal tampoco.
      assert.throws(() => database.valorant.pick(event.id, {
        captainParticipantId: gente[10].id, selectedParticipantId: disponible
      }), (e) => e.code === 'NOT_YOUR_TURN');

      const elegido = database.valorant.pick(event.id, {
        captainParticipantId: capitanes[0], selectedParticipantId: disponible
      });
      assert.equal(elegido.pickNumber, 1);
      assert.equal(elegido.participantId, disponible);
      assert.equal(elegido.draft.currentPick, 2);
    });

    it('rechaza un jugador ya elegido, de otro evento o sin confirmar', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const v = database.valorant;
      v.pick(event.id, { captainParticipantId: capitanes[0], selectedParticipantId: gente[4].id });

      assert.throws(() => v.pick(event.id, { captainParticipantId: capitanes[1], selectedParticipantId: gente[4].id }),
        (e) => e.code === 'TARGET_ALREADY_TAKEN');
      // Un capitan tampoco puede ser elegido: ya tiene equipo.
      assert.throws(() => v.pick(event.id, { captainParticipantId: capitanes[1], selectedParticipantId: capitanes[2] }),
        (e) => e.code === 'TARGET_ALREADY_TAKEN');

      const otro = database.getDefaultEvent();
      const ajeno = database.createParticipant(otro.id, {
        discord_username: 'x#d', game_name: 'Ajeno', friend_code: 'ajeno#4321'
      });
      assert.throws(() => v.pick(event.id, { captainParticipantId: capitanes[1], selectedParticipantId: ajeno.id }),
        (e) => e.code === 'TARGET_EVENT_MISMATCH');
    });

    it('dos elecciones simultáneas del mismo jugador: sólo una entra', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const objetivo = gente[4].id;

      const primera = database.valorant.pick(event.id, {
        captainParticipantId: capitanes[0], selectedParticipantId: objetivo
      });
      assert.equal(primera.pickNumber, 1);

      // La segunda llega tarde: ya no es su turno y el jugador esta cogido.
      assert.throws(() => database.valorant.pick(event.id, {
        captainParticipantId: capitanes[0], selectedParticipantId: objetivo
      }), (e) => e.code === 'NOT_YOUR_TURN' || e.code === 'TARGET_ALREADY_TAKEN');

      assert.equal(database.valorant.listPicks(database.valorant.getDraft(event.id).id).length, 1);
      const equipos = database.valorant.listTeams(event.id);
      const cuantasVeces = equipos.flatMap((t) => t.members).filter((m) => m.participantId === objetivo).length;
      assert.equal(cuantasVeces, 1, 'el jugador está en un solo equipo');
    });

    it('el turno avanza en serpiente durante todo el draft', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const v = database.valorant;
      const esperado = [1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4, 4, 3, 2, 1];
      const disponibles = gente.slice(4).map((p) => p.id);

      for (let i = 0; i < 16; i++) {
        const draft = v.getDraft(event.id);
        const turno = v.teamForPick(event.id, draft.currentPick);
        assert.equal(turno.team.seed, esperado[i], `elección ${i + 1}`);
        v.pick(event.id, {
          captainParticipantId: turno.team.captainParticipantId,
          selectedParticipantId: disponibles[i]
        });
      }

      const draft = v.getDraft(event.id);
      assert.equal(draft.status, 'COMPLETED');
      assert.equal(draft.completedAt !== null, true);

      const equipos = v.listTeams(event.id);
      assert.equal(equipos.length, 4);
      for (const equipo of equipos) {
        assert.equal(equipo.members.length, 5);
        assert.equal(equipo.members.filter((m) => m.role === 'captain').length, 1);
      }
      assert.equal(v.listAvailableParticipants(event.id).length, 0);

      // Y ya no se puede elegir mas.
      assert.throws(() => v.pick(event.id, {
        captainParticipantId: capitanes[0], selectedParticipantId: gente[19].id
      }), (e) => e.code === 'DRAFT_NOT_ACTIVE');
    });
  });

  // ============================ PAUSA ============================

  describe('pausa', () => {
    it('bloquea las elecciones y al reanudar conserva el turno', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const v = database.valorant;
      v.pick(event.id, { captainParticipantId: capitanes[0], selectedParticipantId: gente[4].id });

      const pausado = v.setDraftStatus(event.id, 'PAUSED', { reason: 'incidencia' });
      assert.equal(pausado.status, 'PAUSED');
      assert.equal(pausado.currentPick, 2);

      assert.throws(() => v.pick(event.id, { captainParticipantId: capitanes[1], selectedParticipantId: gente[5].id }),
        (e) => e.code === 'DRAFT_NOT_ACTIVE');

      const reanudado = v.setDraftStatus(event.id, 'ACTIVE');
      assert.equal(reanudado.status, 'ACTIVE');
      assert.equal(reanudado.currentPick, 2, 'sigue por donde iba');

      const hecho = v.pick(event.id, { captainParticipantId: capitanes[1], selectedParticipantId: gente[5].id });
      assert.equal(hecho.pickNumber, 2);
    });
  });

  // ========================= POR LA API =========================

  describe('por la API', () => {
    it('sólo elige el capitán autenticado al que le toca', async () => {
      const { database, app, event, gente, capitanes } = draftEnMarcha();
      const slug = event.slug;

      // Sin sesión.
      const anonimo = await request(app).post(`/api/events/${slug}/draft/pick`)
        .send({ selectedParticipantId: gente[4].id });
      assert.equal(anonimo.status, 401);

      // Cuenta de Discord sin inscripción en este evento.
      const suelta = database.valorant.upsertDiscordAccount({ discordUserId: '77', username: 'suelta' });
      const cookieSuelta = `jarti_session=${database.valorant.createSession(suelta.id)}`;
      const forastero = await request(app).post(`/api/events/${slug}/draft/pick`)
        .set('Cookie', cookieSuelta).send({ selectedParticipantId: gente[4].id });
      assert.equal(forastero.status, 403);

      // Un jugador normal, inscrito, que no es capitán.
      const cookieJugador = sesionDe(database, event, gente[10].id, '10');
      const jugador = await request(app).post(`/api/events/${slug}/draft/pick`)
        .set('Cookie', cookieJugador).send({ selectedParticipantId: gente[4].id });
      assert.equal(jugador.status, 409);
      assert.equal(jugador.body.error.code, 'NOT_YOUR_TURN');

      // El capitán al que le toca.
      const cookieCapitan = sesionDe(database, event, capitanes[0], '1');
      const bueno = await request(app).post(`/api/events/${slug}/draft/pick`)
        .set('Cookie', cookieCapitan).send({ selectedParticipantId: gente[4].id });
      assert.equal(bueno.status, 201);
      assert.equal(bueno.body.pick.pickNumber, 1);
      assert.equal(bueno.body.draft.pick, 2);
    });

    it('el estado público no filtra identidades', async () => {
      const { database, app, event, gente, capitanes } = draftEnMarcha();
      sesionDe(database, event, capitanes[0], '1');
      database.valorant.pick(event.id, { captainParticipantId: capitanes[0], selectedParticipantId: gente[4].id });

      const estado = await request(app).get(`/api/events/${event.slug}/draft`).expect(200);
      const texto = JSON.stringify(estado.body);

      assert.equal(estado.body.status, 'ACTIVE');
      assert.equal(estado.body.teams.length, 4);
      assert.ok(estado.body.picks.length === 1);
      // Nombres publicos si; identidades privadas no.
      assert.ok(texto.includes('Jugador 05'));
      assert.equal(texto.includes('discord'), false, 'no aparece nada de Discord');
      assert.equal(texto.includes('jarti_session'), false);
      assert.equal(/"discordUserId"|"riot_puuid"|"sessionId"/.test(texto), false);
    });

    it('la administración exige token', async () => {
      const { app, event } = montar();
      await request(app).post(`/api/admin/events/${event.id}/draft/start`).expect(401);
      await request(app).get(`/api/admin/events/${event.id}/audit`).expect(401);
    });
  });

  // ========================= ADMINISTRACIÓN =========================

  describe('correcciones de administración', () => {
    it('mueve a un jugador sólo con motivo, y lo deja registrado', async () => {
      const { database, app, event, gente, capitanes } = draftEnMarcha();
      const v = database.valorant;
      v.pick(event.id, { captainParticipantId: capitanes[0], selectedParticipantId: gente[4].id });
      const equipos = v.listTeams(event.id);

      assert.throws(() => v.moveParticipant(event.id, {
        participantId: gente[4].id, toTeamId: equipos[1].id, reason: '   '
      }), (e) => e.code === 'REASON_REQUIRED');

      // A un capitan no se le mueve: primero se cambia el capitan.
      assert.throws(() => v.moveParticipant(event.id, {
        participantId: capitanes[0], toTeamId: equipos[1].id, reason: 'prueba'
      }), (e) => e.code === 'CANNOT_MOVE_CAPTAIN');

      const destino = v.moveParticipant(event.id, {
        participantId: gente[4].id, toTeamId: equipos[1].id, reason: 'se equivocó de sala'
      });
      assert.ok(destino.members.some((m) => m.participantId === gente[4].id));

      const auditoria = await request(app).get(`/api/admin/events/${event.id}/audit`)
        .set('Authorization', `Bearer ${ADMIN}`).expect(200);
      const movimiento = auditoria.body.audit.find((row) => row.action === 'PLAYER_MOVED');
      assert.equal(movimiento.reason, 'se equivocó de sala');
      assert.ok(auditoria.body.audit.some((row) => row.action === 'DRAFT_STARTED'));
      assert.ok(auditoria.body.audit.some((row) => row.action === 'DRAFT_CONFIGURED'));
    });

    it('cambia el capitán de un equipo', () => {
      const { database, event, gente, capitanes } = draftEnMarcha();
      const v = database.valorant;
      v.pick(event.id, { captainParticipantId: capitanes[0], selectedParticipantId: gente[4].id });
      const equipo = v.listTeams(event.id)[0];

      const cambiado = v.changeCaptain(event.id, {
        teamId: equipo.id, participantId: gente[4].id, reason: 'el capitán se cae del torneo'
      });
      assert.equal(cambiado.captainParticipantId, gente[4].id);
      assert.equal(cambiado.members.filter((m) => m.role === 'captain').length, 1);
      assert.equal(cambiado.members.find((m) => m.role === 'captain').participantId, gente[4].id);
    });
  });

  // ============================== MIGRACIÓN ==============================

  describe('migración sobre una base que ya tiene datos', () => {
    it('no toca nada de Among Us y se puede aplicar dos veces', () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-migracion-'));
      directories.push(directory);
      const ruta = path.join(directory, 'tournament.db');

      // --- primera apertura: un torneo de Among Us con datos reales ---
      const primera = openDatabase(ruta);
      const among = primera.getDefaultEvent();
      const [clasificacion] = primera.competition.listStages(among.id);
      const inscrito = primera.createParticipant(among.id, {
        discord_username: 'historico#discord', game_name: 'Histórico', friend_code: 'historico#1234'
      });
      primera.updateParticipant(inscrito.id, { status: 'confirmed' });
      primera.competition.updateStage(clasificacion.id, { status: 'active' });
      const antes = {
        eventos: primera.listEvents().length,
        slug: among.slug,
        inscritos: primera.listParticipants(among.id).length,
        friendCode: primera.listParticipants(among.id)[0].internalFriendCode
      };
      primera.close();

      // --- segunda apertura: la migración vuelve a correr entera ---
      const segunda = openDatabase(ruta);
      assert.equal(segunda.listEvents().length, antes.eventos, 'no se duplican eventos');
      assert.equal(segunda.getDefaultEvent().slug, antes.slug, 'el evento sigue siendo el mismo');
      assert.equal(segunda.listParticipants(among.id).length, antes.inscritos);
      assert.equal(segunda.listParticipants(among.id)[0].internalFriendCode, antes.friendCode);
      assert.equal(segunda.competition.listStages(among.id)[0].status, 'active', 'la fase conserva su estado');
      assert.equal(segunda.competition.getStageLeaderboard(clasificacion.id,
        segunda.competition.listGroups(clasificacion.id)[0].id).matchCount, 0);

      // Y lo nuevo está disponible sin haber pisado nada.
      assert.equal(segunda.valorant.getDraft(among.id), undefined);
      assert.deepEqual(segunda.valorant.listTeams(among.id), []);

      // --- el evento de Valorant se crea aparte y no interfiere ---
      const valorant = segunda.createEvent({
        slug: 'torneo-valorant', name: 'Torneo Valorant', game: 'Valorant',
        description: 'x', status: 'Próximamente',
        accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/x.png'
      });
      assert.equal(segunda.listEvents().length, antes.eventos + 1);
      assert.equal(segunda.getDefaultEvent().slug, antes.slug, 'el evento por defecto no cambia');
      assert.notEqual(valorant.id, among.id);
      segunda.close();
    });
  });
});
