'use strict';

/**
 * Las eliminatorias, de la liga al campeón.
 *
 * Lo que se prueba aquí es lo que el módulo del cuadro no puede probar solo:
 * que los clasificados los deriva el servidor, que el cuadro avanza al guardar
 * un resultado, y que una corrección no puede destrozar partidos ya jugados.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { createFakeProvider } = require('../src/services/ocr/fake-provider');
const { renderScreenshot } = require('./helpers/fake-screenshot');
const { SLOTS } = require('../src/services/playoffs/bracket');

const ADMIN = 'token-de-pruebas';

const TIE_PROFILES = Object.freeze({
  '1/2': {
    winners: [1, 2, 3, 4, 0, 2, 3, 4, 5, 3, 4, 5, 4, 5, 5],
    margins: [10, 12, 10, 6, 2, 7, 2, 10, 13, 5, 13, 3, 4, 3, 8]
  },
  '2/3': {
    winners: [1, 2, 3, 0, 5, 2, 3, 4, 5, 3, 4, 5, 4, 5, 5],
    margins: [8, 8, 10, 5, 12, 3, 9, 7, 7, 3, 7, 4, 8, 10, 13]
  },
  '3/4': {
    winners: [1, 2, 0, 4, 5, 2, 3, 4, 5, 3, 4, 5, 4, 5, 5],
    margins: [2, 7, 2, 11, 4, 8, 5, 10, 13, 11, 3, 4, 6, 11, 5]
  },
  '4/5': {
    winners: [1, 0, 3, 4, 5, 2, 3, 4, 5, 3, 4, 5, 4, 5, 5],
    margins: [8, 10, 2, 13, 8, 11, 8, 12, 4, 7, 12, 3, 8, 9, 2]
  },
  '5/6': {
    winners: [1, 2, 3, 4, 0, 2, 3, 4, 5, 3, 4, 5, 4, 5, 5],
    margins: [6, 13, 10, 2, 13, 2, 6, 6, 10, 7, 9, 2, 8, 13, 8]
  }
});

describe('eliminatorias de Valorant', () => {
  const directorios = [];
  const bases = [];

  afterEach(() => {
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directorios.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  const admin = (app, metodo, ruta, cuerpo) => request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${ADMIN}`).send(cuerpo);

  /** Un torneo con el draft hecho y la liga generada, con mapas puestos. */
  function ligaMontada(teamCount, { ocrProvider = null, storageRoot = null } = {}) {
    const directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-playoffs-'));
    directorios.push(directorio);
    const database = openDatabase(path.join(directorio, 'tournament.db'));
    bases.push(database);
    const app = createApp({
      database, adminToken: ADMIN, ocrProvider,
      captureStorageRoot: storageRoot ?? path.join(directorio, 'uploads')
    });

    const event = database.createEvent({
      slug: teamCount === 4 ? 'torneo-valorant' : `valorant-generico-playoffs-${teamCount}`,
      name: 'Torneo Valorant', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { draft: true }, accentColor: '#ff4655', icon: 'crosshair',
      coverImage: '/images/events/x.png'
    });

    const gente = [];
    for (let i = 1; i <= teamCount * 5; i++) {
      const creado = database.createParticipant(event.id, {
        discord_username: `p${i}#d`, game_name: `Jugador ${String(i).padStart(2, '0')}`
      });
      gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
    }

    database.valorant.configureDraft(event.id, {
      captains: gente.slice(0, teamCount).map((p) => p.id), teamCount, teamSize: 5
    });
    database.valorant.startDraft(event.id);
    for (const persona of gente.slice(teamCount)) {
      const draft = database.valorant.getDraft(event.id);
      const turno = database.valorant.teamForPick(event.id, draft.currentPick);
      database.valorant.pick(event.id, {
        captainParticipantId: turno.team.captainParticipantId,
        selectedParticipantId: persona.id
      });
    }

    const equipos = database.valorant.listTeams(event.id);
    database.valorantCompetition.generateRegularSeason(event.id, equipos.map((e) => e.id));
    for (const serie of database.valorantCompetition.listSeries(event.id)) {
      database.valorantCompetition.assignMap(event.id, { seriesId: serie.id, mapKey: 'ascent' });
    }

    return { directorio, database, app, event, equipos, gente };
  }

  /**
   * Juega la liga entera con un ganador previsible: el de menor semilla.
   * Así la clasificación queda 1-2-3-4-5-6 sin empates.
   */
  function jugarLiga(contexto) {
    const { database, event, equipos } = contexto;
    const semilla = new Map(equipos.map((e) => [e.id, e.seed]));
    for (const serie of database.valorantCompetition.listSeries(event.id)) {
      const ganaA = semilla.get(serie.teamAId) < semilla.get(serie.teamBId);
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: serie.id,
        teamARounds: ganaA ? 13 : 4, teamBRounds: ganaA ? 4 : 13,
        reason: 'carga de prueba'
      });
    }
    return database.valorantCompetition.standings(event.id, { teams: equipos });
  }

  /** Juega un round robin real cuyo único empate relevante cae en la frontera indicada. */
  function jugarPerfilEmpate(contexto, profile) {
    const { database, event, equipos } = contexto;
    database.valorantCompetition.setSettings(event.id, {
      tiebreakers: ['wins', 'round_diff'], actor: 'prueba de empates'
    });
    const pairs = [];
    for (let a = 0; a < equipos.length; a++) {
      for (let b = a + 1; b < equipos.length; b++) pairs.push([a, b]);
    }
    const series = database.valorantCompetition.listSeries(event.id);
    pairs.forEach(([a, b], index) => {
      const teamA = equipos[a].id;
      const teamB = equipos[b].id;
      const serie = series.find((row) => (
        (row.teamAId === teamA && row.teamBId === teamB)
        || (row.teamAId === teamB && row.teamBId === teamA)
      ));
      const winner = equipos[profile.winners[index]].id;
      const loserRounds = 13 - profile.margins[index];
      const winnerIsA = serie.teamAId === winner;
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: serie.id,
        teamARounds: winnerIsA ? 13 : loserRounds,
        teamBRounds: winnerIsA ? loserRounds : 13,
        reason: 'perfil de empate reproducible'
      });
    });
    return database.valorantCompetition.standings(event.id, { teams: equipos });
  }

  /** Gana una serie de eliminatoria, mapa a mapa, hasta cerrarla. */
  function ganarSerie(database, event, seriesId, teamId, { mapas = ['ascent', 'bind', 'haven', 'lotus', 'split'] } = {}) {
    let serie = database.valorantPlayoffs.getSeries(event.id, seriesId);
    const necesarios = Math.floor(serie.bestOf / 2) + 1;

    for (let numero = 1; numero <= serie.bestOf; numero++) {
      serie = database.valorantPlayoffs.getSeries(event.id, seriesId);
      if (serie.status === 'COMPLETED') break;

      database.valorantCompetition.assignMap(event.id, {
        seriesId, gameNumber: numero, mapKey: mapas[numero - 1]
      });
      const ganaA = serie.teamAId === teamId;
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId, gameNumber: numero,
        teamARounds: ganaA ? 13 : 6, teamBRounds: ganaA ? 6 : 13,
        reason: 'eliminatoria de prueba'
      });
    }
    assert.equal(necesarios >= 2, true);
    return database.valorantPlayoffs.getSeries(event.id, seriesId);
  }

  const porSlot = (series, slot) => series.find((serie) => serie.slot === slot);

  // ================================================ GENERACIÓN Y GUARDIAS

  describe('cuándo se puede generar el cuadro', () => {
    it('no con la fase regular a medias', async () => {
      const { app, event } = ligaMontada(4);
      const respuesta = await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {});
      assert.equal(respuesta.status, 409);
      assert.equal(respuesta.body.error.code, 'REGULAR_SEASON_INCOMPLETE');
    });

    it('no si hay un empate sin resolver que afecte a los clasificados', async () => {
      const contexto = ligaMontada(5);
      const { database, app, event, equipos } = contexto;

      // Se deja un solo criterio, y se monta un ciclo donde varios empatan.
      await admin(app, 'put', `/api/admin/events/${event.id}/competition/settings`,
        { tiebreakers: ['wins'] }).expect(200);

      const series = database.valorantCompetition.listSeries(event.id);
      // Todos ganan y pierden lo mismo: empate imposible de deshacer.
      series.forEach((serie, indice) => {
        const ganaA = indice % 2 === 0;
        database.valorantCompetition.recordGameResult(event.id, {
          seriesId: serie.id,
          teamARounds: ganaA ? 13 : 6, teamBRounds: ganaA ? 6 : 13,
          reason: 'montaje de empate'
        });
      });

      const tabla = database.valorantCompetition.standings(event.id, { teams: equipos });
      assert.equal(tabla.tieRequiresAdmin, true, 'el montaje tiene que dejar un empate');

      const respuesta = await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {});
      assert.equal(respuesta.status, 409);
      assert.equal(respuesta.body.error.code, 'PLAYOFF_SEEDING_UNRESOLVED');
    });

    for (const [boundary, position] of [['1/2', 1], ['2/3', 2], ['3/4', 3], ['4/5', 4]]) {
      it(`rechaza un empate ${boundary} porque afecta al top 4`, () => {
        const contexto = ligaMontada(6);
        const tabla = jugarPerfilEmpate(contexto, TIE_PROFILES[boundary]);
        assert.equal(tabla.standings[position - 1].tieRequiresAdmin, true);
        assert.equal(tabla.standings[position].tieRequiresAdmin, true);
        assert.throws(
          () => contexto.database.valorantPlayoffs.generate(contexto.event.id, contexto.equipos),
          (error) => error.code === 'PLAYOFF_SEEDING_UNRESOLVED'
        );
      });
    }

    it('permite un empate 5/6 y conserva el top 4 derivado', () => {
      const contexto = ligaMontada(6);
      const tabla = jugarPerfilEmpate(contexto, TIE_PROFILES['5/6']);
      const top4 = tabla.standings.slice(0, 4).map((row) => row.teamId);
      assert.equal(tabla.standings[4].tieRequiresAdmin, true);
      assert.equal(tabla.standings[5].tieRequiresAdmin, true);

      contexto.database.valorantPlayoffs.generate(contexto.event.id, contexto.equipos);
      const series = contexto.database.valorantPlayoffs.listSeries(contexto.event.id);
      const semi1 = porSlot(series, SLOTS.UPPER_SEMI_1);
      const semi2 = porSlot(series, SLOTS.UPPER_SEMI_2);
      assert.deepEqual(
        [semi1.teamAId, semi2.teamAId, semi2.teamBId, semi1.teamBId],
        top4
      );
      const playoffTeams = new Set(series.flatMap((row) => [row.teamAId, row.teamBId]).filter(Boolean));
      assert.equal(playoffTeams.has(tabla.standings[4].teamId), false);
      assert.equal(playoffTeams.has(tabla.standings[5].teamId), false);
    });

    it('no se genera dos veces', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { app, event } = contexto;

      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);
      const otra = await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {});
      assert.equal(otra.status, 409);
      assert.equal(otra.body.error.code, 'PLAYOFFS_ALREADY_EXIST');

      // Y no se han duplicado series.
      assert.equal(contexto.database.valorantPlayoffs.listSeries(event.id).length, 6);
    });

    it('un force en el cuerpo tampoco la rehace', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { app, event } = contexto;
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);

      const conForce = await admin(app, 'post',
        `/api/admin/events/${event.id}/playoffs/generate`, { force: true });
      assert.equal(conForce.status, 409);
    });

    it('todas las rutas exigen el token', async () => {
      const { app, event } = ligaMontada(4);
      for (const [metodo, ruta] of [
        ['get', `/api/admin/events/${event.id}/playoffs`],
        ['put', `/api/admin/events/${event.id}/playoffs/format`],
        ['post', `/api/admin/events/${event.id}/playoffs/generate`]
      ]) {
        assert.equal((await request(app)[metodo](ruta).send({})).status, 401, `${metodo} ${ruta}`);
        assert.equal((await request(app)[metodo](ruta)
          .set('Authorization', 'Bearer falso').send({})).status, 401);
      }
    });
  });

  // ================================================ CLASIFICADOS 4/5/6

  describe('siempre clasifican cuatro', () => {
    for (const teamCount of [4, 5, 6]) {
      it(`con ${teamCount} equipos entran los cuatro primeros`, async () => {
        const contexto = ligaMontada(teamCount);
        const tabla = jugarLiga(contexto);
        const { database, app, event } = contexto;

        const generada = await admin(app, 'post',
          `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);
        assert.equal(generada.body.series.length, 6);

        const series = database.valorantPlayoffs.listSeries(event.id);
        const cuatro = tabla.standings.slice(0, 4).map((f) => f.teamId);

        // El primero contra el cuarto y el segundo contra el tercero.
        const semi1 = porSlot(series, SLOTS.UPPER_SEMI_1);
        const semi2 = porSlot(series, SLOTS.UPPER_SEMI_2);
        assert.equal(semi1.teamAId, cuatro[0]);
        assert.equal(semi1.teamBId, cuatro[3]);
        assert.equal(semi2.teamAId, cuatro[1]);
        assert.equal(semi2.teamBId, cuatro[2]);
        assert.deepEqual([semi1.teamASeed, semi1.teamBSeed], [1, 4]);
        assert.deepEqual([semi2.teamASeed, semi2.teamBSeed], [2, 3]);

        // Los que no entran, fuera del cuadro.
        const enCuadro = new Set(series.flatMap((s) => [s.teamAId, s.teamBId]).filter(Boolean));
        for (const fila of tabla.standings.slice(4)) {
          assert.equal(enCuadro.has(fila.teamId), false,
            `el ${fila.position}º no debería estar en el cuadro`);
        }
      });
    }

    it('los emparejamientos NO llegan del navegador', async () => {
      const contexto = ligaMontada(4);
      const tabla = jugarLiga(contexto);
      const { database, app, event } = contexto;

      // Se intenta imponer otro sembrado; el servidor lo ignora.
      const alReves = [...tabla.standings].reverse().map((f) => f.teamId);
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {
        seeds: alReves, seed1TeamId: alReves[0]
      }).expect(201);

      const semi1 = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      assert.equal(semi1.teamAId, tabla.standings[0].teamId,
        'el primero del cuadro sale de la clasificación, no del cuerpo de la petición');
    });
  });

  // ================================================ HUECOS POR DETERMINAR

  describe('los huecos que aún no se sabe quién ocupa', () => {
    it('nacen vacíos, no con un equipo inventado', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, app, event } = contexto;
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);

      const series = database.valorantPlayoffs.listSeries(event.id);
      for (const slot of [SLOTS.UPPER_FINAL, SLOTS.LOWER_ROUND_1, SLOTS.LOWER_FINAL, SLOTS.GRAND_FINAL]) {
        const serie = porSlot(series, slot);
        assert.equal(serie.teamAId, null, `${slot} no puede tener equipo todavía`);
        assert.equal(serie.teamBId, null);
        assert.equal(serie.status, 'PENDING');
      }
      // Y la reposición ni siquiera existe.
      assert.equal(porSlot(series, SLOTS.GRAND_FINAL_RESET), undefined);
    });

    it('en público salen como «por determinar»', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { app, event } = contexto;
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);

      const publico = await request(app)
        .get(`/api/events/${event.slug}/competition-teams`).expect(200);
      const finalAlta = publico.body.playoffs.series.find((s) => s.slot === SLOTS.UPPER_FINAL);
      assert.equal(finalAlta.teamA, null);
      assert.equal(finalAlta.teamB, null);
    });
  });

  // ================================================ FORMATO DE LA FINAL

  describe('a cuántos mapas se juega la gran final', () => {
    it('por defecto al mejor de tres, y puede ponerse a cinco antes de empezar', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, app, event } = contexto;

      await admin(app, 'put', `/api/admin/events/${event.id}/playoffs/format`, { bestOf: 5 }).expect(200);
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);

      const series = database.valorantPlayoffs.listSeries(event.id);
      assert.equal(porSlot(series, SLOTS.GRAND_FINAL).bestOf, 5);
      assert.equal(porSlot(series, SLOTS.GRAND_FINAL).games.length, 5);
      assert.equal(porSlot(series, SLOTS.UPPER_SEMI_1).bestOf, 3, 'las demás siguen a tres');
    });

    it('sólo admite tres o cinco', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { app, event } = contexto;
      for (const bestOf of [1, 2, 4, 7, 0]) {
        const respuesta = await admin(app, 'put',
          `/api/admin/events/${event.id}/playoffs/format`, { bestOf });
        assert.equal(respuesta.status, 400, String(bestOf));
        assert.equal(respuesta.body.error.code, 'INVALID_BEST_OF');
      }
    });

    it('no se cambia con el cuadro ya en marcha', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, app, event } = contexto;
      await admin(app, 'post', `/api/admin/events/${event.id}/playoffs/generate`, {}).expect(201);

      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      ganarSerie(database, event, semi.id, semi.teamAId);

      const respuesta = await admin(app, 'put',
        `/api/admin/events/${event.id}/playoffs/format`, { bestOf: 5 });
      assert.equal(respuesta.status, 409);
      assert.equal(respuesta.body.error.code, 'PLAYOFFS_IN_PROGRESS');
    });
  });

  // ================================================ SERIES Y MAPAS

  describe('las series al mejor de tres', () => {
    function conCuadro() {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      contexto.database.valorantPlayoffs.generate(
        contexto.event.id, contexto.equipos);
      return contexto;
    }

    it('un 2-0 cierra la serie y deja el tercer mapa sin jugar', () => {
      const { database, event } = conCuadro();
      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      const terminada = ganarSerie(database, event, semi.id, semi.teamAId);

      assert.equal(terminada.status, 'COMPLETED');
      assert.equal(terminada.winnerTeamId, semi.teamAId);
      assert.deepEqual(terminada.games.map((j) => j.status),
        ['COMPLETED', 'COMPLETED', 'NOT_NEEDED']);
      assert.equal(terminada.games[2].teamARounds, null, 'el tercero no se jugó');
    });

    it('un 2-1 usa los tres mapas', () => {
      const { database, event } = conCuadro();
      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);

      const marcar = (numero, ganador, mapa) => {
        database.valorantCompetition.assignMap(event.id, { seriesId: semi.id, gameNumber: numero, mapKey: mapa });
        const ganaA = ganador === semi.teamAId;
        database.valorantCompetition.recordGameResult(event.id, {
          seriesId: semi.id, gameNumber: numero,
          teamARounds: ganaA ? 13 : 5, teamBRounds: ganaA ? 5 : 13, reason: 'x'
        });
      };
      marcar(1, semi.teamAId, 'ascent');
      marcar(2, semi.teamBId, 'bind');

      let actual = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.notEqual(actual.status, 'COMPLETED', 'con 1-1 la serie sigue');

      marcar(3, semi.teamAId, 'haven');
      actual = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.equal(actual.status, 'COMPLETED');
      assert.equal(actual.winnerTeamId, semi.teamAId);
      assert.equal(actual.games.every((j) => j.status === 'COMPLETED'), true);
    });

    it('no se repite mapa dentro de la misma serie', () => {
      const { database, event } = conCuadro();
      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);

      database.valorantCompetition.assignMap(event.id, { seriesId: semi.id, gameNumber: 1, mapKey: 'ascent' });
      assert.throws(() => database.valorantCompetition.assignMap(event.id, {
        seriesId: semi.id, gameNumber: 2, mapKey: 'ascent'
      }), (error) => error.code === 'MAP_ALREADY_IN_SERIES');

      // Otro mapa sí.
      database.valorantCompetition.assignMap(event.id, { seriesId: semi.id, gameNumber: 2, mapKey: 'bind' });
    });

    it('el marcador de la serie son mapas, no rondas', () => {
      const { database, event, equipos } = conCuadro();
      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      ganarSerie(database, event, semi.id, semi.teamAId);

      const publico = database.valorantPlayoffs.publicState(event.id, equipos);
      const serie = publico.series.find((s) => s.slot === SLOTS.UPPER_SEMI_1);
      assert.deepEqual(serie.seriesScore, { a: 2, b: 0 }, 'dos mapas a cero');
      assert.equal(serie.games[0].teamARounds, 13, 'y las rondas siguen siendo del mapa');
    });
  });

  describe('series al mejor de cinco', () => {
    function hastaGranFinalBo5() {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.setGrandFinalBestOf(event.id, 5, { actor: 'prueba BO5' });
      database.valorantPlayoffs.generate(event.id, equipos);
      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);

      const semi1 = dame(SLOTS.UPPER_SEMI_1);
      const semi2 = dame(SLOTS.UPPER_SEMI_2);
      ganarSerie(database, event, semi1.id, semi1.teamAId);
      ganarSerie(database, event, semi2.id, semi2.teamAId);

      const lowerRound = dame(SLOTS.LOWER_ROUND_1);
      ganarSerie(database, event, lowerRound.id, lowerRound.teamAId);
      const upperFinal = dame(SLOTS.UPPER_FINAL);
      ganarSerie(database, event, upperFinal.id, upperFinal.teamAId);
      const lowerFinal = dame(SLOTS.LOWER_FINAL);
      ganarSerie(database, event, lowerFinal.id, lowerFinal.teamAId);

      return { ...contexto, grandFinal: dame(SLOTS.GRAND_FINAL), dame };
    }

    function playSequence(database, event, series, winnerSides) {
      const maps = ['ascent', 'bind', 'haven', 'lotus', 'split'];
      winnerSides.forEach((side, index) => {
        const gameNumber = index + 1;
        database.valorantCompetition.assignMap(event.id, {
          seriesId: series.id, gameNumber, mapKey: maps[index]
        });
        database.valorantCompetition.recordGameResult(event.id, {
          seriesId: series.id, gameNumber,
          teamARounds: side === 'a' ? 13 : 6,
          teamBRounds: side === 'b' ? 13 : 6,
          reason: 'secuencia BO5'
        });
      });
      return database.valorantPlayoffs.getSeries(event.id, series.id);
    }

    for (const [score, sequence, statuses] of [
      ['3-0', ['a', 'a', 'a'], ['COMPLETED', 'COMPLETED', 'COMPLETED', 'NOT_NEEDED', 'NOT_NEEDED']],
      ['3-1', ['a', 'b', 'a', 'a'], ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'NOT_NEEDED']],
      ['3-2', ['a', 'b', 'a', 'b', 'a'], ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED']]
    ]) {
      it(`${score} exige tres victorias y marca sólo lo que no hace falta`, () => {
        const { database, event, grandFinal } = hastaGranFinalBo5();
        const completed = playSequence(database, event, grandFinal, sequence);
        assert.equal(completed.bestOf, 5);
        assert.equal(completed.winnerTeamId, grandFinal.teamAId);
        assert.deepEqual(completed.games.map((game) => game.status), statuses);
      });
    }

    it('la reposición de una Gran Final BO5 también es BO5 y termina al 3-0', () => {
      const { database, event, grandFinal, dame } = hastaGranFinalBo5();
      const firstFinal = playSequence(database, event, grandFinal, ['b', 'b', 'b']);
      assert.equal(firstFinal.bestOf, 5);
      assert.deepEqual(firstFinal.games.map((game) => game.status),
        ['COMPLETED', 'COMPLETED', 'COMPLETED', 'NOT_NEEDED', 'NOT_NEEDED']);

      const reset = dame(SLOTS.GRAND_FINAL_RESET);
      assert.ok(reset);
      assert.equal(reset.bestOf, 5);
      const completedReset = playSequence(database, event, reset, ['a', 'a', 'a']);
      assert.equal(completedReset.winnerTeamId, reset.teamAId);
      assert.deepEqual(completedReset.games.map((game) => game.status),
        ['COMPLETED', 'COMPLETED', 'COMPLETED', 'NOT_NEEDED', 'NOT_NEEDED']);
    });
  });

  // ================================================ RECORRIDO COMPLETO

  describe('el cuadro entero', () => {
    /** Monta el cuadro y devuelve las semis ya resueltas. */
    function hastaLasSemis({ ganaSemi1 = 'a', ganaSemi2 = 'a' } = {}) {
      const contexto = ligaMontada(6);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const series = database.valorantPlayoffs.listSeries(event.id);
      const semi1 = porSlot(series, SLOTS.UPPER_SEMI_1);
      const semi2 = porSlot(series, SLOTS.UPPER_SEMI_2);

      ganarSerie(database, event, semi1.id, ganaSemi1 === 'a' ? semi1.teamAId : semi1.teamBId);
      ganarSerie(database, event, semi2.id, ganaSemi2 === 'a' ? semi2.teamAId : semi2.teamBId);

      return { ...contexto, semi1, semi2 };
    }

    it('al terminar las semis, el cuadro se ha movido solo', () => {
      const { database, event, semi1, semi2 } = hastaLasSemis();
      const series = database.valorantPlayoffs.listSeries(event.id);

      const finalAlta = porSlot(series, SLOTS.UPPER_FINAL);
      const rondaBaja = porSlot(series, SLOTS.LOWER_ROUND_1);

      assert.equal(finalAlta.teamAId, semi1.teamAId, 'gana la 1 → final alta');
      assert.equal(finalAlta.teamBId, semi2.teamAId);
      assert.equal(rondaBaja.teamAId, semi1.teamBId, 'pierde la 1 → cuadro bajo');
      assert.equal(rondaBaja.teamBId, semi2.teamBId);

      // Con los dos puestos, ya se pueden jugar.
      assert.equal(finalAlta.status, 'READY');
      assert.equal(rondaBaja.status, 'READY');
      // Y las que siguen dependiendo de ellas, no.
      assert.equal(porSlot(series, SLOTS.LOWER_FINAL).status, 'PENDING');
    });

    it('camino sin reposición: gana el del cuadro alto', () => {
      const contexto = hastaLasSemis();
      const { database, event, equipos } = contexto;
      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);

      const rondaBaja = dame(SLOTS.LOWER_ROUND_1);
      ganarSerie(database, event, rondaBaja.id, rondaBaja.teamAId);
      const cuarto = rondaBaja.teamBId;

      const finalAlta = dame(SLOTS.UPPER_FINAL);
      const deArriba = finalAlta.teamAId;
      ganarSerie(database, event, finalAlta.id, deArriba);

      const finalBaja = dame(SLOTS.LOWER_FINAL);
      assert.equal(finalBaja.teamBId, finalAlta.teamBId, 'el que pierde arriba baja');
      ganarSerie(database, event, finalBaja.id, finalBaja.teamAId);
      const tercero = finalBaja.teamBId;

      const granFinal = dame(SLOTS.GRAND_FINAL);
      assert.equal(granFinal.teamAId, deArriba);
      ganarSerie(database, event, granFinal.id, deArriba);

      // No hay reposición: el de arriba llegaba sin derrotas y ganó.
      assert.equal(dame(SLOTS.GRAND_FINAL_RESET), undefined);

      const tabla = database.valorantPlayoffs.standings(event.id);
      assert.equal(tabla.status, 'COMPLETED');
      assert.equal(tabla.champion, deArriba);

      const puesto = (teamId) => tabla.placements.find((f) => f.teamId === teamId).position;
      assert.equal(puesto(tabla.champion), 1);
      assert.equal(puesto(tabla.runnerUp), 2);
      assert.equal(puesto(tercero), 3);
      assert.equal(puesto(cuarto), 4);

      // Y el quinto y el sexto de la liga nunca entraron.
      const liga = database.valorantCompetition.standings(event.id, { teams: equipos });
      const enCuadro = new Set(tabla.placements.map((f) => f.teamId));
      for (const fila of liga.standings.slice(4)) {
        assert.equal(enCuadro.has(fila.teamId), false);
      }
    });

    it('camino con reposición: gana el del cuadro bajo', () => {
      const contexto = hastaLasSemis();
      const { database, event } = contexto;
      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);

      const rondaBaja = dame(SLOTS.LOWER_ROUND_1);
      ganarSerie(database, event, rondaBaja.id, rondaBaja.teamAId);

      const finalAlta = dame(SLOTS.UPPER_FINAL);
      const deArriba = finalAlta.teamAId;
      ganarSerie(database, event, finalAlta.id, deArriba);

      const finalBaja = dame(SLOTS.LOWER_FINAL);
      const deAbajo = finalBaja.teamAId;
      ganarSerie(database, event, finalBaja.id, deAbajo);

      // --- antes de la gran final: uno sin derrotas y otro con una ---
      let derrotas = database.valorantPlayoffs.losses(event.id);
      assert.equal(derrotas.get(deArriba) ?? 0, 0, 'el del cuadro alto llega intacto');
      assert.equal(derrotas.get(deAbajo), 1, 'el del bajo llega con una');

      const granFinal = dame(SLOTS.GRAND_FINAL);
      ganarSerie(database, event, granFinal.id, deAbajo);

      // --- ahora los dos tienen una: hay que repetir ---
      derrotas = database.valorantPlayoffs.losses(event.id);
      assert.equal(derrotas.get(deArriba), 1);
      assert.equal(derrotas.get(deAbajo), 1);

      const reposicion = dame(SLOTS.GRAND_FINAL_RESET);
      assert.ok(reposicion, 'tiene que aparecer la reposición');
      assert.equal(reposicion.status, 'READY');
      assert.equal(reposicion.bestOf, granFinal.bestOf, 'al mismo número de mapas');
      assert.deepEqual([reposicion.teamAId, reposicion.teamBId].sort(), [deArriba, deAbajo].sort());

      // Mientras no se juegue, no hay campeón y nadie está eliminado.
      let tabla = database.valorantPlayoffs.standings(event.id);
      assert.equal(tabla.status, 'PENDING');
      assert.equal(tabla.champion, null);
      for (const teamId of [deArriba, deAbajo]) {
        assert.equal(tabla.placements.find((f) => f.teamId === teamId).result, 'ACTIVE',
          'con una derrota nadie está fuera');
      }

      // --- se juega y decide ---
      ganarSerie(database, event, reposicion.id, deArriba);
      tabla = database.valorantPlayoffs.standings(event.id);
      assert.equal(tabla.status, 'COMPLETED');
      assert.equal(tabla.champion, deArriba);
      assert.equal(tabla.runnerUp, deAbajo);
      assert.equal(tabla.placements.find((f) => f.teamId === deAbajo).losses, 2,
        'el subcampeón termina con dos derrotas');
    });
  });

  // ================================================ CORRECCIONES

  describe('corregir un resultado del cuadro', () => {
    function conSemiJugada() {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      database.valorantCompetition.assignMap(event.id, { seriesId: semi.id, gameNumber: 1, mapKey: 'ascent' });
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: semi.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 7, reason: 'primer mapa'
      });
      return { ...contexto, semi };
    }

    function conFinalAltaJugada({ semi1MapWinners = ['a', 'a'] } = {}) {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);
      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);
      const semi1 = dame(SLOTS.UPPER_SEMI_1);
      const semi2 = dame(SLOTS.UPPER_SEMI_2);

      semi1MapWinners.forEach((side, index) => {
        const gameNumber = index + 1;
        database.valorantCompetition.assignMap(event.id, {
          seriesId: semi1.id, gameNumber, mapKey: ['ascent', 'bind', 'haven'][index]
        });
        const winner = side === 'a' ? semi1.teamAId : semi1.teamBId;
        database.valorantCompetition.recordGameResult(event.id, {
          seriesId: semi1.id, gameNumber,
          teamARounds: winner === semi1.teamAId ? 13 : 6,
          teamBRounds: winner === semi1.teamBId ? 13 : 6,
          reason: 'semifinal preparada'
        });
      });
      ganarSerie(database, event, semi2.id, semi2.teamAId);
      const finalAlta = dame(SLOTS.UPPER_FINAL);
      ganarSerie(database, event, finalAlta.id, finalAlta.teamAId);
      return { ...contexto, semi1, finalAlta, dame };
    }

    it('una corrección que no cambia el ganador se acepta', () => {
      const { database, event, semi } = conSemiJugada();
      const corregida = database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 9, reason: 'leí mal las rondas'
      });
      assert.equal(corregida.games[0].teamBRounds, 9);
      assert.equal(corregida.games[0].winnerTeamId, semi.teamAId, 'sigue ganando el mismo');
    });

    it('permite corregir rondas sin cambiar ganador aunque el downstream esté completado', () => {
      const { database, event, semi1, dame } = conFinalAltaJugada();
      const downstreamBefore = dame(SLOTS.UPPER_FINAL);
      const corrected = database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi1.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 9, reason: 'rondas corregidas'
      });
      assert.equal(corrected.winnerTeamId, semi1.teamAId);
      assert.equal(corrected.games[0].teamBRounds, 9);
      assert.deepEqual(dame(SLOTS.UPPER_FINAL), downstreamBefore);
      assert.equal(dame(SLOTS.UPPER_FINAL).winnerTeamId, downstreamBefore.winnerTeamId);
    });

    it('permite cambiar el ganador de un mapa si el ganador final de serie no cambia', () => {
      const { database, event, semi1, dame } = conFinalAltaJugada({
        semi1MapWinners: ['a', 'b', 'a']
      });
      const downstreamBefore = dame(SLOTS.UPPER_FINAL);
      const corrected = database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi1.id, gameNumber: 2,
        teamARounds: 13, teamBRounds: 7, reason: 'mapa asignado al lado incorrecto'
      });
      assert.equal(corrected.games[1].winnerTeamId, semi1.teamAId);
      assert.equal(corrected.winnerTeamId, semi1.teamAId);
      assert.deepEqual(dame(SLOTS.UPPER_FINAL), downstreamBefore);
    });

    it('una corrección que cambia el ganador, sin nada jugado después, se acepta', () => {
      const { database, event, semi } = conSemiJugada();
      database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi.id, gameNumber: 1,
        teamARounds: 7, teamBRounds: 13, reason: 'marcador al revés'
      });

      const actual = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.equal(actual.games[0].winnerTeamId, semi.teamBId);
      assert.notEqual(actual.status, 'COMPLETED', 'con 1-0 la serie sigue abierta');
    });

    it('si la corrección cambia quién gana la SERIE, el cuadro se rehace', () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      ganarSerie(database, event, semi.id, semi.teamAId);

      // El cuadro ya ha avanzado, pero nadie ha jugado todavía ahí.
      let finalAlta = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_FINAL);
      assert.equal(finalAlta.teamAId, semi.teamAId);

      // Se corrigen los dos mapas: ahora gana el otro.
      for (const numero of [1, 2]) {
        database.valorantCompetition.correctGameResult(event.id, {
          seriesId: semi.id, gameNumber: numero,
          teamARounds: 6, teamBRounds: 13, reason: 'se anotaron invertidos'
        });
      }

      const actual = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.equal(actual.winnerTeamId, semi.teamBId);

      finalAlta = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_FINAL);
      assert.equal(finalAlta.teamAId, semi.teamBId, 'a la final alta sube el nuevo ganador');

      const rondaBaja = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.LOWER_ROUND_1);
      assert.equal(rondaBaja.teamAId, semi.teamAId, 'y el otro baja');
    });

    it('si ya se ha jugado algo después, se BLOQUEA', () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);
      const semi1 = dame(SLOTS.UPPER_SEMI_1);
      const semi2 = dame(SLOTS.UPPER_SEMI_2);
      ganarSerie(database, event, semi1.id, semi1.teamAId);
      ganarSerie(database, event, semi2.id, semi2.teamAId);

      // Se empieza a jugar la final alta.
      const finalAlta = dame(SLOTS.UPPER_FINAL);
      database.valorantCompetition.assignMap(event.id, {
        seriesId: finalAlta.id, gameNumber: 1, mapKey: 'lotus'
      });
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: finalAlta.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 8, reason: 'ya en juego'
      });
      const semiBefore = database.valorantPlayoffs.getSeries(event.id, semi1.id);
      const downstreamBefore = dame(SLOTS.UPPER_FINAL);

      // Ahora corregir la semifinal cambiaría quién debía jugar ese partido.
      assert.throws(() => database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi1.id, gameNumber: 1,
        teamARounds: 6, teamBRounds: 13, reason: 'demasiado tarde'
      }), (error) => error.code === 'BRACKET_DEPENDENCY_LOCKED');

      // Y no se ha tocado nada: el resultado sigue como estaba.
      const intacta = database.valorantPlayoffs.getSeries(event.id, semi1.id);
      assert.deepEqual(intacta, semiBefore);
      assert.deepEqual(dame(SLOTS.UPPER_FINAL), downstreamBefore);
    });

    it('queda registrado quién corrigió y por qué', async () => {
      const { database, app, event, semi } = conSemiJugada();
      database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 11, reason: 'ajuste de rondas'
      });

      const auditoria = await admin(app, 'get', `/api/admin/events/${event.id}/audit`).expect(200);
      const correccion = auditoria.body.audit.find((fila) => fila.action === 'RESULT_CORRECTED');
      assert.equal(correccion.reason, 'ajuste de rondas');
      assert.ok(auditoria.body.audit.some((fila) => fila.action === 'PLAYOFFS_GENERATED'));
    });
  });

  describe('invariante de los huecos del cuadro', () => {
    it('no sobrescribe un equipo distinto ya presente en el destino', () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, event, equipos, directorio } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);
      const series = database.valorantPlayoffs.listSeries(event.id);
      const semi = porSlot(series, SLOTS.UPPER_SEMI_1);
      const finalAlta = porSlot(series, SLOTS.UPPER_FINAL);

      const raw = new BetterSqlite3(path.join(directorio, 'tournament.db'));
      raw.prepare('UPDATE valorant_series SET team_a_id=? WHERE id=?')
        .run(semi.teamBId, finalAlta.id);
      raw.close();

      database.valorantCompetition.assignMap(event.id, {
        seriesId: semi.id, gameNumber: 1, mapKey: 'ascent'
      });
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: semi.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 6, reason: 'primer mapa'
      });
      database.valorantCompetition.assignMap(event.id, {
        seriesId: semi.id, gameNumber: 2, mapKey: 'bind'
      });

      assert.throws(() => database.valorantCompetition.recordGameResult(event.id, {
        seriesId: semi.id, gameNumber: 2,
        teamARounds: 13, teamBRounds: 6, reason: 'segundo mapa'
      }), (error) => error.code === 'BRACKET_SLOT_CONFLICT');

      const intactSemi = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.equal(intactSemi.status, 'WAITING_RESULT');
      assert.equal(intactSemi.games[1].status, 'WAITING_RESULT');
      assert.equal(
        porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_FINAL).teamAId,
        semi.teamBId
      );
    });
  });

  // ================================================ CAPTURAS EN PLAYOFFS

  describe('resultados por captura', () => {
    it('un partido del cuadro se resuelve con el mismo flujo de capturas', async () => {
      // El OCR falso lee un partido con los nombres reales de ese equipo.
      const contexto = ligaMontada(4, { ocrProvider: createFakeProvider('') });
      jugarLiga(contexto);
      const { database, app, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      database.valorantCompetition.assignMap(event.id, {
        seriesId: semi.id, gameNumber: 1, mapKey: 'ascent'
      });

      const equipoA = equipos.find((e) => e.id === semi.teamAId);
      const equipoB = equipos.find((e) => e.id === semi.teamBId);
      const jugadores = [...equipoA.members, ...equipoB.members];
      const col = (valor, ancho) => String(valor).padEnd(ancho);
      const lineas = [
        'VALORANT COMPETITIVE',
        'ASCENT',
        `${equipoA.name.toUpperCase()}  13`,
        `${equipoB.name.toUpperCase()}  6`,
        '',
        `${col('PLAYER', 24)}${col('AGENT', 10)}${col('ACS', 6)}${col('K', 5)}${col('D', 5)}A`,
        ...jugadores.map((miembro, i) =>
          `${col(miembro.displayName, 24)}${col('Raze', 10)}${col(250 - i * 9, 6)}`
          + `${col(20 - i, 5)}${col(10 + i, 5)}${3 + (i % 5)}`)
      ];
      contexto.app.locals; // sin efecto: el proveedor se configura abajo
      // El proveedor falso se ajusta al partido que toca.
      const proveedor = createFakeProvider(lineas.join('\n'));
      const appConOcr = createApp({
        database, adminToken: ADMIN, ocrProvider: proveedor,
        captureStorageRoot: path.join(contexto.directorio, 'uploads2')
      });

      const imagen = await renderScreenshot(lineas);
      const subida = await request(appConOcr)
        .post(`/api/admin/events/${event.id}/competition/captures`)
        .set('Authorization', `Bearer ${ADMIN}`)
        .field('seriesId', String(semi.id))
        .field('gameNumber', '1')
        .attach('captures', imagen, { filename: 'semi.png', contentType: 'image/png' });

      assert.equal(subida.status, 201, JSON.stringify(subida.body));
      const preview = subida.body.preview;
      assert.equal(preview.map, 'ascent');
      assert.equal(preview.teamARounds, 13);
      assert.equal(preview.teamBRounds, 6);

      const confirmada = await request(appConOcr)
        .post(`/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .set('Authorization', `Bearer ${ADMIN}`)
        .send({
          mapKey: preview.map,
          teamARounds: preview.teamARounds, teamBRounds: preview.teamBRounds,
          players: preview.players.filter((j) => j.participantId).map((j) => ({
            participantId: j.participantId, agent: j.agent,
            acs: j.acs, kills: j.kills, deaths: j.deaths, assists: j.assists
          }))
        });
      assert.equal(confirmada.status, 200, JSON.stringify(confirmada.body));

      // El mismo camino de siempre: la partida se cierra y la serie se recalcula.
      const actual = database.valorantPlayoffs.getSeries(event.id, semi.id);
      assert.equal(actual.games[0].status, 'COMPLETED');
      assert.equal(actual.games[0].resultSource, 'SCREENSHOT');
      assert.equal(actual.games[0].winnerTeamId, semi.teamAId);
      assert.deepEqual(
        database.valorantPlayoffs.publicState(event.id, equipos)
          .series.find((s) => s.slot === SLOTS.UPPER_SEMI_1).seriesScore,
        { a: 1, b: 0 });
      assert.equal(app !== appConOcr, true);
    });
  });

  describe('recorrido pre-deploy de seis equipos', () => {
    it('va de 30 inscritos a campeón con captura, reset y auditoría reconstruible', async () => {
      const contexto = ligaMontada(6);
      const { database, event, equipos, gente, directorio } = contexto;
      const regular = jugarLiga(contexto);
      assert.equal(gente.length, 30);
      assert.equal(equipos.length, 6);
      assert.equal(equipos.every((team) => team.members.length === 5), true);
      assert.equal(database.valorantCompetition.listSeries(event.id, 'REGULAR').length, 15);
      assert.equal(regular.complete, true);
      const top4 = regular.standings.slice(0, 4).map((row) => row.teamId);

      database.valorantPlayoffs.generate(event.id, equipos, { actor: 'orquestador-predeploy' });
      const dame = (slot) => porSlot(database.valorantPlayoffs.listSeries(event.id), slot);
      const semi1 = dame(SLOTS.UPPER_SEMI_1);
      const semi2 = dame(SLOTS.UPPER_SEMI_2);
      database.valorantCompetition.assignMap(event.id, {
        seriesId: semi1.id, gameNumber: 1, mapKey: 'ascent'
      });

      const teamA = equipos.find((team) => team.id === semi1.teamAId);
      const teamB = equipos.find((team) => team.id === semi1.teamBId);
      const players = [...teamA.members, ...teamB.members];
      const col = (value, width) => String(value).padEnd(width);
      const lines = [
        'VALORANT COMPETITIVE',
        'ASCENT',
        `${teamA.name.toUpperCase()}  13`,
        `${teamB.name.toUpperCase()}  6`,
        '',
        `${col('PLAYER', 24)}${col('AGENT', 10)}${col('ACS', 6)}${col('K', 5)}${col('D', 5)}A`,
        ...players.map((member, index) =>
          `${col(member.displayName, 24)}${col('Raze', 10)}${col(280 - index * 8, 6)}`
          + `${col(22 - index, 5)}${col(10 + index, 5)}${3 + (index % 4)}`)
      ];
      const app = createApp({
        database,
        adminToken: ADMIN,
        ocrProvider: createFakeProvider(lines.join('\n')),
        captureStorageRoot: path.join(directorio, 'predeploy-uploads')
      });
      const image = await renderScreenshot(lines);
      const upload = await request(app)
        .post(`/api/admin/events/${event.id}/competition/captures`)
        .set('Authorization', `Bearer ${ADMIN}`)
        .field('seriesId', String(semi1.id))
        .field('gameNumber', '1')
        .attach('captures', image, { filename: 'upper-semi-1.png', contentType: 'image/png' });
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      assert.equal(upload.body.preview.map, 'ascent');
      assert.deepEqual(
        [upload.body.preview.teamARounds, upload.body.preview.teamBRounds],
        [13, 6]
      );
      const preview = upload.body.preview;
      const confirmed = await request(app)
        .post(`/api/admin/events/${event.id}/competition/captures/${upload.body.batch.id}/confirm`)
        .set('Authorization', `Bearer ${ADMIN}`)
        .send({
          mapKey: preview.map,
          teamARounds: preview.teamARounds,
          teamBRounds: preview.teamBRounds,
          players: preview.players.filter((player) => player.participantId).map((player) => ({
            participantId: player.participantId,
            agent: player.agent,
            acs: player.acs,
            kills: player.kills,
            deaths: player.deaths,
            assists: player.assists
          }))
        });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(database.valorantPlayoffs.getSeries(event.id, semi1.id).games[0].resultSource, 'SCREENSHOT');

      database.valorantCompetition.assignMap(event.id, {
        seriesId: semi1.id, gameNumber: 2, mapKey: 'bind'
      });
      database.valorantCompetition.recordGameResult(event.id, {
        seriesId: semi1.id, gameNumber: 2,
        teamARounds: 13, teamBRounds: 7, reason: 'cierre manual de semifinal'
      });
      ganarSerie(database, event, semi2.id, semi2.teamAId);
      database.valorantCompetition.correctGameResult(event.id, {
        seriesId: semi2.id, gameNumber: 1,
        teamARounds: 13, teamBRounds: 8,
        reason: 'corrección auditada de rondas', actor: 'revisor-predeploy'
      });

      const lowerRound = dame(SLOTS.LOWER_ROUND_1);
      ganarSerie(database, event, lowerRound.id, lowerRound.teamAId);
      const fourth = lowerRound.teamBId;
      const upperFinal = dame(SLOTS.UPPER_FINAL);
      ganarSerie(database, event, upperFinal.id, upperFinal.teamAId);
      const lowerFinal = dame(SLOTS.LOWER_FINAL);
      ganarSerie(database, event, lowerFinal.id, lowerFinal.teamAId);
      const third = lowerFinal.teamBId;

      const grandFinal = dame(SLOTS.GRAND_FINAL);
      ganarSerie(database, event, grandFinal.id, grandFinal.teamBId);
      const reset = dame(SLOTS.GRAND_FINAL_RESET);
      assert.ok(reset);
      ganarSerie(database, event, reset.id, reset.teamAId);

      const finalTable = database.valorantPlayoffs.standings(event.id);
      assert.equal(finalTable.status, 'COMPLETED');
      assert.equal(finalTable.placements.length, 4);
      assert.equal(finalTable.placements.find((row) => row.teamId === fourth).position, 4);
      assert.equal(finalTable.placements.find((row) => row.teamId === third).position, 3);
      assert.equal(finalTable.placements.find((row) => row.position === 1).teamId, finalTable.champion);
      assert.equal(finalTable.placements.find((row) => row.position === 2).teamId, finalTable.runnerUp);
      assert.deepEqual(new Set(finalTable.placements.map((row) => row.teamId)), new Set(top4));
      assert.equal(finalTable.placements.some((row) => row.teamId === regular.standings[4].teamId), false);
      assert.equal(finalTable.placements.some((row) => row.teamId === regular.standings[5].teamId), false);

      const auditResponse = await admin(app, 'get', `/api/admin/events/${event.id}/audit`).expect(200);
      const audit = auditResponse.body.audit;
      const details = (entry) => typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details;
      assert.equal(audit.find((entry) => entry.action === 'PLAYOFFS_GENERATED').actor, 'orquestador-predeploy');
      assert.ok(audit.some((entry) => entry.action === 'RESULT_RECORDED' && details(entry)?.source === 'MANUAL'));
      assert.ok(audit.some((entry) => entry.action === 'RESULT_RECORDED' && details(entry)?.source === 'SCREENSHOT'));
      assert.ok(audit.some((entry) => entry.action === 'RESULT_CORRECTED'
        && entry.reason === 'corrección auditada de rondas'));
      assert.ok(audit.some((entry) => entry.action === 'PLAYOFF_BRACKET_ADVANCED'));
      assert.ok(audit.some((entry) => entry.action === 'PLAYOFF_RESET_CREATED'));
    });
  });

  // ================================================ PÚBLICO

  describe('lo que se publica del cuadro', () => {
    it('sale el cuadro entero, sin nada privado', async () => {
      const contexto = ligaMontada(4);
      jugarLiga(contexto);
      const { database, app, event, equipos } = contexto;
      database.valorantPlayoffs.generate(event.id, equipos);

      const semi = porSlot(database.valorantPlayoffs.listSeries(event.id), SLOTS.UPPER_SEMI_1);
      ganarSerie(database, event, semi.id, semi.teamAId);

      const publico = await request(app)
        .get(`/api/events/${event.slug}/competition-teams`).expect(200);
      const cuadro = publico.body.playoffs;

      assert.equal(cuadro.generated, true);
      assert.equal(cuadro.series.length, 6);
      const jugada = cuadro.series.find((s) => s.slot === SLOTS.UPPER_SEMI_1);
      assert.equal(jugada.label, 'Semifinal alta 1');
      assert.equal(jugada.bracket, 'UPPER');
      assert.deepEqual(jugada.seriesScore, { a: 2, b: 0 });
      assert.equal(jugada.teamA.seed, 1);
      assert.equal(jugada.games[0].mapKey, 'ascent');

      const texto = JSON.stringify(publico.body).toLowerCase();
      for (const prohibido of ['discord', 'reason', 'audit', 'storagekey', 'sha256', 'ocr']) {
        assert.equal(texto.includes(prohibido), false, `no debe salir ${prohibido}`);
      }
    });

    it('sin cuadro generado, lo dice y ya', async () => {
      const contexto = ligaMontada(4);
      const publico = await request(contexto.app)
        .get(`/api/events/${contexto.event.slug}/competition-teams`).expect(200);
      assert.equal(publico.body.playoffs.generated, false);
      assert.deepEqual(publico.body.playoffs.series, []);
    });
  });
});
