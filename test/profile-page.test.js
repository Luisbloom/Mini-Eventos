'use strict';

/**
 * El perfil del jugador.
 *
 * Lo que se prueba aquí no es que la página pinte, sino que enseñe lo que su
 * dueño quiere ver —contra quién juega, cómo va y con quién— sin enseñar de
 * paso los datos privados de sus compañeros.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');

describe('perfil del jugador', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-perfil-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  // Windows no deja borrar un fichero abierto: primero se cierra la base.
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const NOMBRES = ['Vega', 'Duna', 'Sirena', 'Lobo', 'Cierzo', 'Trueno', 'Ambar', 'Zorro',
    'Marea', 'Quilla', 'Brisa', 'Norte', 'Faro', 'Ancla', 'Rada', 'Delta',
    'Coral', 'Nieve', 'Rayo', 'Barro'];

  /** Un torneo con draft hecho, liga generada y el primer jugador con sesión. */
  function torneoMontado({ conLiga = true } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'torneo-valorant-perfil',
      name: 'Torneo Valorant',
      game: 'Valorant',
      description: 'Un torneo de prueba.',
      status: 'Inscripciones abiertas',
      registrationsOpen: true,
      minParticipants: 20,
      modules: { draft: true, information: true, participants: true }
    });

    const inscritos = NOMBRES.map((nombre, indice) => {
      const creado = database.createParticipant(evento.id, {
        discord_username: `${nombre.toLowerCase()}#discord`, game_name: nombre
      });
      const confirmado = database.updateParticipant(creado.id, { status: 'confirmed' });
      database.valorant.setRiotId(evento.id, {
        participantId: confirmado.id,
        riotId: `${nombre}#${String(indice).padStart(3, '0')}`,
        reason: 'prueba'
      });
      return confirmado;
    });

    database.valorant.configureDraft(evento.id, {
      captains: inscritos.slice(0, 4).map((p) => p.id), teamCount: 4, teamSize: 5
    });
    database.valorant.startDraft(evento.id);
    const cola = inscritos.slice(4).map((p) => p.id);
    while (cola.length) {
      const draft = database.valorant.getDraft(evento.id);
      const turno = database.valorant.teamForPick(evento.id, draft.currentPick);
      database.valorant.pick(evento.id, {
        captainParticipantId: turno.team.captainParticipantId,
        selectedParticipantId: cola.shift()
      });
    }

    const equipos = database.valorant.listTeams(evento.id);
    if (conLiga) {
      database.valorantCompetition.setMapPool(evento.id, ['ascent', 'bind', 'haven']);
      database.valorantCompetition.generateRegularSeason(evento.id, equipos.map((e) => e.id));
      for (const serie of database.valorantCompetition.listSeries(evento.id)) {
        database.valorantCompetition.assignMap(evento.id, { seriesId: serie.id, mapKey: 'bind' });
      }
    }

    // El primer capitán es quien mira su perfil.
    const yo = inscritos[0];
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: '900001', username: 'vega', displayName: 'Vega'
    });
    database.valorant.linkParticipantToDiscord(yo.id, cuenta.id);
    const cookie = `jarti_session=${database.valorant.createSession(cuenta.id)}`;

    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    return { database, app, evento, equipos, cookie, yo };
  }

  const perfil = (app, cookie) => request(app).get('/api/me/profile').set('Cookie', cookie);

  it('sin sesión no dice nada de nadie', async () => {
    const { app } = torneoMontado();
    const respuesta = await request(app).get('/api/me/profile').expect(200);
    assert.equal(respuesta.body.authenticated, false);
    assert.equal(respuesta.body.registrations, undefined);
  });

  it('enseña el equipo con sus compañeros', async () => {
    const { app, cookie } = torneoMontado();
    const cuerpo = (await perfil(app, cookie).expect(200)).body;
    const registro = cuerpo.registrations[0];

    assert.equal(cuerpo.authenticated, true);
    assert.ok(registro.team, 'debe tener equipo tras el draft');
    assert.equal(registro.team.members.length, 5);
    assert.equal(registro.team.members.filter((m) => m.role === 'captain').length, 1);
    assert.ok(registro.team.members.every((m) => m.displayName));
  });

  it('de los compañeros sólo sale el nombre visible', async () => {
    const { app, cookie } = torneoMontado();
    const cuerpo = (await perfil(app, cookie).expect(200)).body;
    const compañeros = cuerpo.registrations[0].team.members;

    for (const miembro of compañeros) {
      assert.deepEqual(Object.keys(miembro).sort(), ['displayName', 'role']);
    }
    // Ni el Riot ID de otro, ni identificadores internos.
    const texto = JSON.stringify(compañeros);
    assert.ok(!/#\d{3}/.test(texto), 'no puede colarse el Riot ID de un compañero');
    assert.ok(!/participantId|discord/i.test(texto));
  });

  it('dice contra quién juega y en qué jornada', async () => {
    const { app, cookie } = torneoMontado();
    const registro = (await perfil(app, cookie).expect(200)).body.registrations[0];

    assert.ok(registro.nextMatch, 'con la liga generada tiene que haber próximo partido');
    assert.ok(registro.nextMatch.opponentName, 'el rival tiene nombre');
    assert.equal(typeof registro.nextMatch.matchday, 'number');
    assert.deepEqual(registro.nextMatch.maps, ['bind']);
  });

  it('dice cómo va el equipo', async () => {
    const { app, cookie, database, evento } = torneoMontado();

    // Se juega la primera serie para que la tabla tenga contenido.
    const primera = database.valorantCompetition.listSeries(evento.id)[0];
    database.valorantCompetition.recordGameResult(evento.id, {
      seriesId: primera.id, teamARounds: 13, teamBRounds: 7, reason: 'prueba'
    });

    const registro = (await perfil(app, cookie).expect(200)).body.registrations[0];
    assert.ok(registro.standing, 'tiene que haber clasificación');
    assert.equal(typeof registro.standing.position, 'number');
    assert.equal(registro.standing.wins + registro.standing.losses, registro.standing.played);
    assert.equal(typeof registro.seriesTotal, 'number');
  });

  it('sin liga generada no se inventa una clasificación', async () => {
    const { app, cookie } = torneoMontado({ conLiga: false });
    const registro = (await perfil(app, cookie).expect(200)).body.registrations[0];

    assert.ok(registro.team, 'el equipo del draft sí existe');
    assert.equal(registro.standing, null);
    assert.equal(registro.nextMatch, null);
  });

  it('el perfil no filtra datos de otras cuentas', async () => {
    const { app, cookie } = torneoMontado();
    const texto = JSON.stringify((await perfil(app, cookie).expect(200)).body);
    assert.ok(!texto.includes('discordUserId'));
    assert.ok(!texto.includes('internalFriendCode'));
    assert.ok(!/"discord_username"/.test(texto));
  });
});
