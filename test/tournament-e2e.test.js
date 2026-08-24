'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { generateReporterToken, hashReporterToken } = require('../src/services/reporter-auth');

/**
 * El torneo entero por la API real: 20 inscritos, dos grupos jugando a la vez
 * con su propio host, y despues la final. Los tests existentes cubren cada pieza
 * por separado; esto comprueba que encajan y, sobre todo, que un host no puede
 * tocar el grupo del otro.
 */
describe('torneo completo de Among Us', () => {
  const directories = [];
  const bases = [];
  const ADMIN = 'token-de-pruebas';

  afterEach(() => {
    // Cerrar SQLite antes de borrar: si no, Windows no deja quitar el archivo.
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directories.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  function montar() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-e2e-'));
    directories.push(directory);
    const database = openDatabase(path.join(directory, 'tournament.db'));
    bases.push(database);
    const app = createApp({ database, adminToken: ADMIN });
    return { database, app };
  }

  /** 20 inscritos confirmados, repartidos 10/10 como en el torneo real. */
  function inscribirVeinte(database, event) {
    const inscritos = [];
    for (let i = 1; i <= 20; i++) {
      const nombre = `jugador${String(i).padStart(2, '0')}`;
      const creado = database.createParticipant(event.id, {
        discord_username: `${nombre}#discord`,
        game_name: `Jugador ${i}`,
        friend_code: `${nombre}#${1000 + i}`
      });
      inscritos.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
    }
    return inscritos;
  }

  function credencial(database, event, identifier) {
    const host = database.competition.listHosts(event.id).find((h) => h.identifier === identifier);
    const token = generateReporterToken();
    database.competition.setHostReporterToken(event.id, host.id, { tokenHash: hashReporterToken(token) });
    return { host, token };
  }

  const enviar = (app, slug, credencial, cuerpo) => request(app)
    .post(`/api/events/${slug}/matches`)
    .set('Authorization', `Bearer ${credencial.token}`)
    .set('X-Host-Id', credencial.host.identifier)
    .send({ hostId: credencial.host.identifier, ...cuerpo });

  /**
   * Una partida donde gana el impostor. Va rotando por jugador para que la
   * clasificacion tenga un top 5 claro: si ganara siempre el mismo, el resto
   * empataria y el sistema se negaria a cerrar la fase, con razon.
   */
  function partida(reportId, matchNumber, miembros, scope, impostor = 0) {
    return {
      reportId,
      matchNumber,
      stageId: scope.stageId,
      groupId: scope.groupId ?? null,
      winner: 'impostor',
      gameMode: 'standard',
      playedAt: '2026-08-28T18:30:00.000Z',
      players: miembros.map((m, index) => ({
        participantId: m.participantId,
        friendCode: null,
        team: index === impostor ? 'impostor' : 'crew',
        role: index === impostor ? 'impostor' : 'crew',
        won: index === impostor,
        kills: index === impostor ? 2 : 0,
        tasksCompleted: index === impostor ? 0 : 4,
        tasksTotal: index === impostor ? 0 : 4,
        allTasksCompleted: index !== impostor
      }))
    };
  }

  it('lleva 20 inscritos por dos grupos en paralelo y una final que empieza de cero', async () => {
    const { database, app } = montar();
    const event = database.getDefaultEvent();
    const [clasificacion, final] = database.competition.listStages(event.id);

    inscribirVeinte(database, event);
    database.competition.updateStage(clasificacion.id, { status: 'active' });
    const asignaciones = database.competition.distributeGroups(clasificacion.id);
    const [grupoA, grupoB] = database.competition.listGroups(clasificacion.id);
    assert.equal(asignaciones.filter((r) => r.groupId === grupoA.id).length, 10);
    assert.equal(asignaciones.filter((r) => r.groupId === grupoB.id).length, 10);

    const host1 = credencial(database, event, 'HOST_1');
    const host2 = credencial(database, event, 'HOST_2');
    database.competition.setHostAssignment(event.id, host1.host.id, { stageId: clasificacion.id, groupId: grupoA.id });
    database.competition.setHostAssignment(event.id, host2.host.id, { stageId: clasificacion.id, groupId: grupoB.id });

    const ambitoA = { stageId: clasificacion.id, groupId: grupoA.id };
    const ambitoB = { stageId: clasificacion.id, groupId: grupoB.id };
    const miembrosA = database.competition.listStageParticipants(clasificacion.id, grupoA.id);
    const miembrosB = database.competition.listStageParticipants(clasificacion.id, grupoB.id);

    // --- cada host ve solo su grupo -------------------------------------
    const contextoA = await request(app).get('/api/reporter/context')
      .set('Authorization', `Bearer ${host1.token}`).set('X-Host-Id', 'HOST_1').expect(200);
    assert.equal(contextoA.body.group.id, grupoA.id);
    assert.equal(contextoA.body.matchNumber, 1);
    assert.equal(contextoA.body.reportingEnabled, true);
    // El roster viaja como huella, nunca como Friend Code.
    assert.ok(contextoA.body.roster.every((r) => !r.friendCode && r.friendCodeFingerprint));

    // --- HOST_1 no puede reportar el Grupo B ----------------------------
    const invasion = await enviar(app, event.slug, host1, partida('HOST_1-invade-b', 1, miembrosB, ambitoA));
    assert.equal(invasion.status, 409);
    assert.equal(invasion.body.error.code, 'PLAYER_SCOPE_MISMATCH');

    // --- y HOST_2 tampoco el Grupo A ------------------------------------
    const invasionInversa = await enviar(app, event.slug, host2, partida('HOST_2-invade-a', 1, miembrosA, ambitoB));
    assert.equal(invasionInversa.status, 409);

    // --- las cinco partidas de cada grupo, en paralelo -------------------
    for (let n = 1; n <= 5; n++) {
      await enviar(app, event.slug, host1, partida(`HOST_1-m${n}`, n, miembrosA, ambitoA, n - 1)).expect(201);
      await enviar(app, event.slug, host2, partida(`HOST_2-m${n}`, n, miembrosB, ambitoB, n - 1)).expect(201);
    }

    // --- el numero de partida corre independiente en cada grupo ---------
    const finA = await request(app).get('/api/reporter/context')
      .set('Authorization', `Bearer ${host1.token}`).set('X-Host-Id', 'HOST_1').expect(200);
    assert.deepEqual(finA.body.occupiedMatchNumbers, [1, 2, 3, 4, 5]);

    // --- un hueco ocupado se rechaza ------------------------------------
    const repetido = await enviar(app, event.slug, host1, partida('HOST_1-otro-id', 3, miembrosA, ambitoA));
    assert.equal(repetido.status, 409);
    assert.equal(repetido.body.error.code, 'MATCH_SLOT_OCCUPIED');

    // --- reenviar el mismo informe no duplica ---------------------------
    const replay = await enviar(app, event.slug, host1, partida('HOST_1-m1', 1, miembrosA, ambitoA, 0));
    assert.equal(replay.status, 200);

    // --- puntuacion: la calcula el servidor -----------------------------
    const tablaA = database.competition.getStageLeaderboard(clasificacion.id, grupoA.id);
    const tablaB = database.competition.getStageLeaderboard(clasificacion.id, grupoB.id);
    assert.equal(tablaA.matchCount, 5);
    assert.equal(tablaB.matchCount, 5);
    // Quien gana una vez como impostor: 5 + 2 kills = 7, mas 1 por cada una de
    // las otras cuatro partidas completando tareas = 11.
    assert.equal(tablaA.standings[0].points, 11);
    // Quien nunca es impostor: 1 punto por partida completando tareas = 5.
    assert.equal(tablaA.standings.at(-1).points, 5);

    // --- los grupos no se mezclan ---------------------------------------
    const idsA = new Set(tablaA.standings.map((r) => r.participantId));
    assert.ok(tablaB.standings.every((r) => !idsA.has(r.participantId)));

    // --- final: 5 de cada grupo -----------------------------------------
    database.competition.completeStage(clasificacion.id);
    const finalistas = database.competition.listStageParticipants(final.id);
    assert.equal(finalistas.length, 10);

    // LO IMPORTANTE: la final empieza a cero. Clasificar da la plaza, no ventaja.
    const inicial = database.competition.getStageLeaderboard(final.id);
    assert.ok(inicial.standings.every((r) => r.points === 0), 'la final arranca sin puntos');
    assert.equal(inicial.matchCount, 0);

    // --- la final se juega con su propio host y su propia numeracion -----
    database.competition.updateStage(final.id, { status: 'active' });
    database.competition.setHostAssignment(event.id, host1.host.id, { stageId: final.id, groupId: null });
    for (let n = 1; n <= 5; n++) {
      await enviar(app, event.slug, host1, partida(`FINAL-m${n}`, n, finalistas, { stageId: final.id, groupId: null }, n - 1)).expect(201);
    }

    const tablaFinal = database.competition.getStageLeaderboard(final.id);
    assert.equal(tablaFinal.matchCount, 5, 'solo cuenta las partidas de la final');
    assert.equal(tablaFinal.standings[0].points, 11);

    // --- y la fase de grupos conserva su historial intacto ---------------
    const tablaAdespues = database.competition.getStageLeaderboard(clasificacion.id, grupoA.id);
    assert.equal(tablaAdespues.matchCount, 5);
    assert.equal(tablaAdespues.standings[0].points, 11);
  });

  it('nunca acepta los puntos que declare el cliente', async () => {
    const { database, app } = montar();
    const event = database.getDefaultEvent();
    const [clasificacion] = database.competition.listStages(event.id);
    inscribirVeinte(database, event);
    database.competition.updateStage(clasificacion.id, { status: 'active' });
    database.competition.distributeGroups(clasificacion.id);
    const [grupoA] = database.competition.listGroups(clasificacion.id);
    const host1 = credencial(database, event, 'HOST_1');
    database.competition.setHostAssignment(event.id, host1.host.id, { stageId: clasificacion.id, groupId: grupoA.id });
    const ambito = { stageId: clasificacion.id, groupId: grupoA.id };
    const miembros = database.competition.listStageParticipants(clasificacion.id, grupoA.id);

    const trucada = partida('HOST_1-trucada', 1, miembros, ambito);
    // Un host con credencial valida intenta imponer su propia puntuacion.
    trucada.players = trucada.players.map((p) => ({ ...p, points: 999, score: 999 }));
    await enviar(app, event.slug, host1, trucada).expect(201);

    const tabla = database.competition.getStageLeaderboard(clasificacion.id, grupoA.id);
    assert.ok(tabla.standings.every((r) => r.points !== 999), 'el servidor ignora los puntos del cliente');
    assert.equal(tabla.standings[0].points, 7, 'victoria de impostor (5) + dos kills (2)');

    // Y tampoco quedan guardados, para que ninguna vista los lea despues.
    const guardadas = database.listAllMatches(event.id);
    const jugadores = guardadas.flatMap((m) => m.report.players || []);
    assert.ok(jugadores.length > 0);
    assert.ok(jugadores.every((p) => p.points === undefined && p.score === undefined));
  });

  it('rechaza un jugador desconocido, uno sin confirmar y un informe malformado', async () => {
    const { database, app } = montar();
    const event = database.getDefaultEvent();
    const [clasificacion] = database.competition.listStages(event.id);
    inscribirVeinte(database, event);
    database.competition.updateStage(clasificacion.id, { status: 'active' });
    database.competition.distributeGroups(clasificacion.id);
    const [grupoA] = database.competition.listGroups(clasificacion.id);
    const host1 = credencial(database, event, 'HOST_1');
    database.competition.setHostAssignment(event.id, host1.host.id, { stageId: clasificacion.id, groupId: grupoA.id });
    const ambito = { stageId: clasificacion.id, groupId: grupoA.id };
    const miembros = database.competition.listStageParticipants(clasificacion.id, grupoA.id);

    // Friend Code que no existe en el torneo.
    const desconocido = partida('HOST_1-desconocido', 1, miembros, ambito);
    desconocido.players[0] = { friendCode: 'nadie#9999', team: 'crew', role: 'crew', won: false };
    const sinVincular = await enviar(app, event.slug, host1, desconocido);
    assert.equal(sinVincular.status, 409);
    assert.equal(sinVincular.body.error.code, 'PLAYER_NOT_LINKED');

    // Inscrito que existe pero no esta confirmado.
    const pendiente = database.createParticipant(event.id, {
      discord_username: 'pendiente#discord', game_name: 'Pendiente', friend_code: 'pendiente#4321'
    });
    const conPendiente = partida('HOST_1-pendiente', 1, miembros, ambito);
    conPendiente.players[0] = { participantId: pendiente.id, team: 'crew', role: 'crew', won: false };
    const noConfirmado = await enviar(app, event.slug, host1, conPendiente);
    assert.equal(noConfirmado.status, 409);

    // Sin jugadores.
    const vacio = await enviar(app, event.slug, host1, { reportId: 'HOST_1-vacio', matchNumber: 1, stageId: ambito.stageId, groupId: ambito.groupId, players: [] });
    assert.equal(vacio.status, 400);

    // Sin reportId.
    const sinId = await enviar(app, event.slug, host1, partida('', 1, miembros, ambito));
    assert.equal(sinId.status, 400);
  });
});
