'use strict';

/**
 * Escribir las estadísticas a mano.
 *
 * Quien organiza ve las tablas con sus ojos: si la captura falla, no existe, o
 * simplemente prefiere teclear, tiene que poder rellenar y corregir cualquier
 * celda sin tocar el marcador.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');

describe('estadísticas a mano', () => {
  const ADMIN = 'admin-test';
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-stats-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const admin = (app, metodo, ruta, cuerpo) => request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${ADMIN}`).send(cuerpo);

  /** Liga de cuatro con la primera serie ya jugada, sin estadísticas. */
  function montado() {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'liga-stats', name: 'Liga', game: 'Valorant', description: 'x',
      status: 'Inscripciones abiertas', registrationsOpen: true, minParticipants: 20,
      modules: { draft: true, participants: true }
    });
    const inscritos = Array.from({ length: 20 }, (_, i) => {
      const creado = database.createParticipant(evento.id, {
        discord_username: `p${i}#d`, game_name: `J${i}`
      });
      return database.updateParticipant(creado.id, { status: 'confirmed' });
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
    database.valorantCompetition.setMapPool(evento.id, ['bind']);
    database.valorantCompetition.generateRegularSeason(evento.id, equipos.map((e) => e.id));
    const serie = database.valorantCompetition.listSeries(evento.id)[0];
    database.valorantCompetition.assignMap(evento.id, { seriesId: serie.id, mapKey: 'bind' });
    database.valorantCompetition.recordGameResult(evento.id, {
      seriesId: serie.id, teamARounds: 13, teamBRounds: 8, reason: 'a mano'
    });

    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: ADMIN });
    return { database, app, evento, serie, equipos };
  }

  it('ofrece las plantillas para rellenar una tabla vacía', async () => {
    const { app, evento, serie } = montado();
    const respuesta = await admin(app, 'get',
      `/api/admin/events/${evento.id}/competition/stats?seriesId=${serie.id}&gameNumber=1`).expect(200);

    assert.equal(respuesta.body.rosters.length, 2);
    assert.equal(respuesta.body.rosters[0].members.length, 5);
    assert.ok(respuesta.body.rosters[0].members.every((m) => m.displayName));
    // Todavía no hay nada escrito, y no se finge que sí.
    assert.deepEqual(respuesta.body.stats, []);
  });

  it('guarda lo tecleado y lo publica', async () => {
    const { app, database, evento, serie, equipos } = montado();
    const jugadores = [serie.teamAId, serie.teamBId].flatMap((teamId, indice) => {
      const equipo = equipos.find((e) => e.id === teamId);
      return equipo.members.map((miembro, i) => ({
        participantId: miembro.participantId, teamId,
        agent: 'jett', acs: 200 + indice * 10 + i, kills: 15 - i, deaths: 10, assists: 4
      }));
    });

    await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`, {
      seriesId: serie.id, gameNumber: 1, stats: jugadores, reason: 'la captura salió borrosa'
    }).expect(200);

    const publico = await request(app)
      .get(`/api/events/${evento.slug}/competition-teams`).expect(200);
    assert.ok(publico.body.playerStats.length >= 10, 'las estadísticas llegan a la web');

    const registro = database.valorant.listAudit(evento.id)
      .find((fila) => fila.action === 'GAME_STATS_EDITED');
    assert.ok(registro, 'queda en la auditoría');
    assert.match(JSON.stringify(registro), /borrosa/);
  });

  it('corrige lo que trajo una captura, celda a celda', async () => {
    const { app, database, evento, serie, equipos } = montado();
    const equipo = equipos.find((e) => e.id === serie.teamAId);
    const uno = equipo.members[0];

    const base = (acs) => [{
      participantId: uno.participantId, teamId: serie.teamAId, agent: 'sova', acs, kills: 12, deaths: 9
    }];

    await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`,
      { seriesId: serie.id, gameNumber: 1, stats: base(180), reason: 'leído de la captura' }).expect(200);

    // El OCR se equivocó: se corrige a mano mirando la pantalla.
    const corregido = await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`,
      { seriesId: serie.id, gameNumber: 1, stats: base(238), reason: 'el OCR leyó 180 y eran 238' })
      .expect(200);

    assert.equal(corregido.body.stats.find((f) => f.participantId === uno.participantId).acs, 238);
    assert.equal(database.valorant.listAudit(evento.id)
      .filter((f) => f.action === 'GAME_STATS_EDITED').length, 2);
  });

  it('exige motivo, como toda escritura a mano', async () => {
    const { app, evento, serie } = montado();
    const respuesta = await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`, {
      seriesId: serie.id, gameNumber: 1, stats: []
    });
    assert.equal(respuesta.status, 400);
    assert.equal(respuesta.body.error.code, 'REASON_REQUIRED');
  });

  it('no deja escribir estadísticas de una partida sin resultado', async () => {
    const { app, database, evento } = montado();
    const otra = database.valorantCompetition.listSeries(evento.id)[1];
    const respuesta = await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`, {
      seriesId: otra.id, gameNumber: 1, stats: [], reason: 'x'
    });
    assert.equal(respuesta.status, 409);
    assert.equal(respuesta.body.error.code, 'RESULT_NOT_RECORDED');
  });

  it('no acepta jugadores de otro equipo', async () => {
    const { app, database, evento, serie, equipos } = montado();
    const ajeno = equipos.find((e) => e.id !== serie.teamAId && e.id !== serie.teamBId);
    const respuesta = await admin(app, 'put', `/api/admin/events/${evento.id}/competition/stats`, {
      seriesId: serie.id,
      gameNumber: 1,
      stats: [{ participantId: ajeno.members[0].participantId, teamId: ajeno.id, acs: 200 }],
      reason: 'prueba'
    });
    assert.equal(respuesta.status, 400);
    assert.equal(respuesta.body.error.code, 'TEAM_NOT_IN_SERIES');
  });

  it('sin token de administración no se toca nada', async () => {
    const { app, evento, serie } = montado();
    for (const [metodo, ruta] of [
      ['get', `/api/admin/events/${evento.id}/competition/stats?seriesId=${serie.id}`],
      ['put', `/api/admin/events/${evento.id}/competition/stats`]
    ]) {
      const respuesta = await request(app)[metodo](ruta).send({});
      assert.equal(respuesta.status, 401, `${metodo} ${ruta}`);
    }
  });
});
