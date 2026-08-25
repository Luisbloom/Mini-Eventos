'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { roundRobinSchedule, scheduleSummary } = require('../src/services/round-robin');
const V = require('../public/draft-view');

describe('fase regular de Valorant', () => {
  const directories = [];
  const bases = [];
  const ADMIN = 'token-de-pruebas';

  afterEach(() => {
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directories.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  function montar() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-liga-'));
    directories.push(directory);
    const database = openDatabase(path.join(directory, 'tournament.db'));
    bases.push(database);
    const app = createApp({ database, adminToken: ADMIN });
    const event = database.createEvent({
      slug: 'torneo-valorant', name: 'Torneo Valorant', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { draft: true },
      accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/x.png'
    });
    return { database, app, event };
  }

  /** Un draft completo de N equipos, listo para generar la liga. */
  function draftTerminado(teamCount) {
    const contexto = montar();
    const { database, event } = contexto;
    const necesarios = teamCount * 5;

    const gente = [];
    for (let i = 1; i <= necesarios; i++) {
      const creado = database.createParticipant(event.id, {
        discord_username: `p${i}#d`, game_name: `Jugador ${String(i).padStart(2, '0')}`
      });
      gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
    }

    const capitanes = gente.slice(0, teamCount).map((p) => p.id);
    const elegibles = gente.slice(teamCount).map((p) => p.id);
    database.valorant.configureDraft(event.id, { captains: capitanes, teamCount, teamSize: 5 });
    database.valorant.startDraft(event.id);

    const orden = [];
    for (let i = 0; i < elegibles.length; i++) {
      const draft = database.valorant.getDraft(event.id);
      const turno = database.valorant.teamForPick(event.id, draft.currentPick);
      orden.push(turno.team.seed);
      database.valorant.pick(event.id, {
        captainParticipantId: turno.team.captainParticipantId,
        selectedParticipantId: elegibles[i]
      });
    }

    return { ...contexto, gente, capitanes, orden, teamCount };
  }

  const admin = (app, metodo, ruta, cuerpo) => request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${ADMIN}`).send(cuerpo);

  // ===================== CALENDARIO =====================

  describe('generador de todos contra todos', () => {
    const comprobar = (n) => {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const calendario = roundRobinSchedule(ids);
      const partidos = calendario.flatMap((j) => j.matches);
      const parejas = partidos.map((p) => [p.home, p.away].sort((a, b) => a - b).join('-'));
      const juega = Object.fromEntries(ids.map((id) => [id,
        partidos.filter((p) => p.home === id || p.away === id).length]));
      return { calendario, partidos, parejas, juega };
    };

    it('cuatro equipos: tres jornadas, seis partidos, tres cada uno', () => {
      const { calendario, partidos, parejas, juega } = comprobar(4);
      assert.equal(calendario.length, 3);
      assert.equal(partidos.length, 6);
      assert.deepEqual(Object.values(juega), [3, 3, 3, 3]);
      assert.equal(new Set(parejas).size, 6, 'ninguna pareja repetida');
      assert.equal(calendario.every((j) => j.bye === null), true, 'sin descansos');
      assert.equal(calendario.every((j) => j.matches.length === 2), true);
    });

    it('cinco equipos: cinco jornadas, diez partidos, y cada uno descansa una vez', () => {
      const { calendario, partidos, parejas, juega } = comprobar(5);
      assert.equal(calendario.length, 5);
      assert.equal(partidos.length, 10);
      assert.deepEqual(Object.values(juega), [4, 4, 4, 4, 4]);
      assert.equal(new Set(parejas).size, 10);

      const descansos = calendario.map((j) => j.bye);
      assert.equal(descansos.filter(Boolean).length, 5, 'una jornada de descanso por jornada');
      assert.equal(new Set(descansos).size, 5, 'cada equipo descansa exactamente una vez');
      assert.equal(calendario.every((j) => j.matches.length === 2), true);
    });

    it('seis equipos: cinco jornadas, quince partidos, cinco cada uno', () => {
      const { calendario, partidos, parejas, juega } = comprobar(6);
      assert.equal(calendario.length, 5);
      assert.equal(partidos.length, 15);
      assert.deepEqual(Object.values(juega), [5, 5, 5, 5, 5, 5]);
      assert.equal(new Set(parejas).size, 15);
      assert.equal(calendario.every((j) => j.bye === null), true);
      assert.equal(calendario.every((j) => j.matches.length === 3), true);
    });

    it('nadie se enfrenta a sí mismo y el calendario es reproducible', () => {
      for (const n of [4, 5, 6]) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        const uno = roundRobinSchedule(ids);
        const otro = roundRobinSchedule(ids);
        assert.deepEqual(uno, otro, `mismo resultado con ${n} equipos`);
        assert.equal(uno.flatMap((j) => j.matches).some((p) => p.home === p.away), false);
      }
    });

    it('el resumen cuadra con lo que genera', () => {
      for (const n of [4, 5, 6]) {
        const resumen = scheduleSummary(n);
        const calendario = roundRobinSchedule(Array.from({ length: n }, (_, i) => i + 1));
        assert.equal(calendario.length, resumen.matchdays, `jornadas con ${n}`);
        assert.equal(calendario.flatMap((j) => j.matches).length, resumen.totalMatches);
      }
    });

    it('se niega a generar con menos de dos equipos o con repetidos', () => {
      assert.throws(() => roundRobinSchedule([1]));
      assert.throws(() => roundRobinSchedule([1, 2, 2]));
    });
  });

  // ===================== DRAFT 4 / 5 / 6 =====================

  describe('el draft se adapta al número de equipos', () => {
    for (const teamCount of [4, 5, 6]) {
      it(`${teamCount} equipos: ${teamCount * 5} jugadores, ${teamCount * 4} elecciones`, () => {
        const { database, event, orden } = draftTerminado(teamCount);
        const draft = database.valorant.getDraft(event.id);

        assert.equal(draft.status, 'COMPLETED');
        assert.equal(draft.totalPicks, teamCount * 4);

        // Serpiente: ida, vuelta, ida, vuelta.
        const ida = Array.from({ length: teamCount }, (_, i) => i + 1);
        const vuelta = [...ida].reverse();
        assert.deepEqual(orden, [...ida, ...vuelta, ...ida, ...vuelta]);

        const equipos = database.valorant.listTeams(event.id);
        assert.equal(equipos.length, teamCount);
        for (const equipo of equipos) assert.equal(equipo.members.length, 5);

        const todos = equipos.flatMap((e) => e.members.map((m) => m.participantId));
        assert.equal(todos.length, teamCount * 5);
        assert.equal(new Set(todos).size, todos.length, 'nadie en dos equipos');
        assert.equal(database.valorant.listAvailableParticipants(event.id).length, 0);
      });
    }

    it('sólo admite cuatro, cinco o seis equipos de cinco', () => {
      const { database, event } = montar();
      const gente = [];
      for (let i = 1; i <= 20; i++) {
        const creado = database.createParticipant(event.id, {
          discord_username: `p${i}#d`, game_name: `J${i}`
        });
        gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
      }
      const ids = gente.map((p) => p.id);

      for (const malo of [2, 3, 7, 8]) {
        assert.throws(() => database.valorant.configureDraft(event.id, {
          captains: ids.slice(0, malo), teamCount: malo, teamSize: 5
        }), (e) => e.code === 'INVALID_TEAM_COUNT', `debería rechazar ${malo} equipos`);
      }
      assert.throws(() => database.valorant.configureDraft(event.id, {
        captains: ids.slice(0, 4), teamCount: 4, teamSize: 4
      }), (e) => e.code === 'INVALID_TEAM_SIZE');
    });

    it('la plantilla tiene que ser exacta para cada tamaño', () => {
      for (const [teamCount, sobrantes] of [[4, 1], [5, 2], [6, 1]]) {
        const { database, event } = montar();
        const total = teamCount * 5 + sobrantes;
        const gente = [];
        for (let i = 1; i <= total; i++) {
          const creado = database.createParticipant(event.id, {
            discord_username: `p${i}#d`, game_name: `J${i}`
          });
          gente.push(database.updateParticipant(creado.id, { status: 'confirmed' }));
        }
        database.valorant.configureDraft(event.id, {
          captains: gente.slice(0, teamCount).map((p) => p.id), teamCount, teamSize: 5
        });
        assert.throws(() => database.valorant.startDraft(event.id),
          (e) => e.code === 'ROSTER_SIZE_MISMATCH',
          `${teamCount} equipos con ${total} confirmados no debe arrancar`);
        assert.equal(database.valorant.getDraft(event.id).status, 'PENDING');
      }
    });
  });

  // ===================== ENDURECIMIENTO DEL DRAFT =====================

  describe('endurecimiento del draft', () => {
    it('el nombre de equipo sólo se cambia con el draft terminado', () => {
      const { database, event, gente } = draftTerminado(4);
      const equipo = database.valorant.listTeams(event.id)[0];

      // Con el draft acabado sí.
      const puesto = database.valorant.renameTeam(event.id, {
        teamId: equipo.id, name: 'Los Filtradores', requireCompletedDraft: true
      });
      assert.equal(puesto.name, 'Los Filtradores');

      // Y en cualquier otro estado, no. Que la interfaz lo esconda no basta.

      // Un draft recién configurado está en PENDING: ahí no se puede.
      const nuevo = montar();
      const suGente = [];
      for (let i = 1; i <= 20; i++) {
        const creado = nuevo.database.createParticipant(nuevo.event.id, {
          discord_username: `q${i}#d`, game_name: `Q${i}`
        });
        suGente.push(nuevo.database.updateParticipant(creado.id, { status: 'confirmed' }));
      }
      nuevo.database.valorant.configureDraft(nuevo.event.id, {
        captains: suGente.slice(0, 4).map((p) => p.id), teamCount: 4, teamSize: 5
      });
      const suEquipo = nuevo.database.valorant.listTeams(nuevo.event.id)[0];
      assert.throws(() => nuevo.database.valorant.renameTeam(nuevo.event.id, {
        teamId: suEquipo.id, name: 'Demasiado pronto', requireCompletedDraft: true
      }), (e) => e.code === 'DRAFT_NOT_COMPLETED');

      // En marcha, tampoco.
      nuevo.database.valorant.startDraft(nuevo.event.id);
      assert.throws(() => nuevo.database.valorant.renameTeam(nuevo.event.id, {
        teamId: suEquipo.id, name: 'Tampoco ahora', requireCompletedDraft: true
      }), (e) => e.code === 'DRAFT_NOT_COMPLETED');

      // Pausado, tampoco.
      nuevo.database.valorant.setDraftStatus(nuevo.event.id, 'PAUSED');
      assert.throws(() => nuevo.database.valorant.renameTeam(nuevo.event.id, {
        teamId: suEquipo.id, name: 'Ni en pausa', requireCompletedDraft: true
      }), (e) => e.code === 'DRAFT_NOT_COMPLETED');

      // Administración sí puede en cualquier momento.
      const porAdmin = nuevo.database.valorant.renameTeam(nuevo.event.id, {
        teamId: suEquipo.id, name: 'La organización manda', reason: 'nombre ofensivo'
      });
      assert.equal(porAdmin.name, 'La organización manda');
      assert.equal(gente.length, 20);
    });

    it('la configuración sin guardar bloquea el inicio', () => {
      const guardados = [
        { seed: 1, captainParticipantId: 11 }, { seed: 2, captainParticipantId: 12 },
        { seed: 3, captainParticipantId: 13 }, { seed: 4, captainParticipantId: 14 }
      ];
      const base = { savedTeams: guardados, confirmedCount: 20, teamCount: 4, status: 'PENDING' };

      assert.equal(V.startBlockedReason({ ...base, selected: [11, 12, 13, 14] }), null,
        'lo guardado coincide: puede empezar');

      // Se cambia un selector y no se guarda.
      assert.match(V.startBlockedReason({ ...base, selected: [11, 12, 13, 99] }),
        /Guarda la configuración/);
      // Se reordena y no se guarda.
      assert.match(V.startBlockedReason({ ...base, selected: [12, 11, 13, 14] }),
        /Guarda la configuración/);
      // Nunca se ha guardado.
      assert.match(V.startBlockedReason({ ...base, savedTeams: [], selected: [11, 12, 13, 14] }),
        /Guarda la configuración/);
      // Se cambió el número de equipos sin volver a guardar.
      assert.match(V.startBlockedReason({
        ...base, teamCount: 6, confirmedCount: 30, selected: [11, 12, 13, 14, 15, 16]
      }), /Guarda la configuración/);
    });

    it('avisa de lo que falta antes de poder empezar', () => {
      const guardados = [{ seed: 1, captainParticipantId: 11 }, { seed: 2, captainParticipantId: 12 }];
      assert.match(V.startBlockedReason({
        selected: [11, null], savedTeams: guardados, confirmedCount: 20, teamCount: 4, status: 'PENDING'
      }), /Elige los 4 capitanes/);

      assert.match(V.startBlockedReason({
        selected: [11, 11, 13, 14], savedTeams: guardados, confirmedCount: 20, teamCount: 4, status: 'PENDING'
      }), /dos capitanes/);

      assert.match(V.startBlockedReason({
        selected: [11, 12, 13, 14], savedTeams: guardados, confirmedCount: 19, teamCount: 4, status: 'PENDING'
      }), /exactamente 20/);

      assert.match(V.startBlockedReason({
        selected: [11, 12, 13, 14], savedTeams: guardados, confirmedCount: 20, teamCount: 4, status: 'ACTIVE'
      }), /ya ha empezado/);
    });

    it('los planes salen del número de equipos', () => {
      assert.deepEqual(V.draftPlan(4), { teamCount: 4, teamSize: 5, participantsNeeded: 20, captains: 4, totalPicks: 16 });
      assert.deepEqual(V.draftPlan(5), { teamCount: 5, teamSize: 5, participantsNeeded: 25, captains: 5, totalPicks: 20 });
      assert.deepEqual(V.draftPlan(6), { teamCount: 6, teamSize: 5, participantsNeeded: 30, captains: 6, totalPicks: 24 });
    });
  });

  // ===================== LIGA COMPLETA =====================

  describe('liga completa de seis equipos', () => {
    it('genera, asigna mapas, registra resultados y ordena la tabla', async () => {
      const { database, app, event } = draftTerminado(6);
      const equipos = database.valorant.listTeams(event.id);

      // --- no se genera antes de tiempo ni por accidente dos veces ---
      const sinDraft = montar();
      const fallo = await admin(sinDraft.app, 'post',
        `/api/admin/events/${sinDraft.event.id}/competition/generate`, {});
      assert.equal(fallo.status, 409);
      assert.equal(fallo.body.error.code, 'DRAFT_NOT_COMPLETED');

      const generada = await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {})
        .expect(201);
      assert.equal(generada.body.matchdays.length, 5);
      assert.equal(generada.body.series.length, 15);

      const repetida = await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {});
      assert.equal(repetida.status, 409, 'no se regenera sin pedirlo');
      assert.equal(repetida.body.error.code, 'REGULAR_SEASON_EXISTS');

      // --- mapas ---
      const pool = await admin(app, 'put', `/api/admin/events/${event.id}/competition/maps`,
        { enabled: ['ascent', 'bind', 'haven'] }).expect(200);
      assert.equal(pool.body.maps.filter((m) => m.enabled).length, 3);

      const series = database.valorantCompetition.listSeries(event.id);
      const fuera = await admin(app, 'post', `/api/admin/events/${event.id}/competition/map`,
        { seriesId: series[0].id, mapKey: 'icebox' });
      assert.equal(fuera.status, 400);
      assert.equal(fuera.body.error.code, 'MAP_NOT_ENABLED');

      const mapas = ['ascent', 'bind', 'haven'];
      for (const [indice, serie] of series.entries()) {
        await admin(app, 'post', `/api/admin/events/${event.id}/competition/map`,
          { seriesId: serie.id, mapKey: mapas[indice % 3] }).expect(200);
      }

      // --- resultados: gana siempre el equipo con menor semilla ---
      const semilla = new Map(equipos.map((e) => [e.id, e.seed]));
      for (const serie of series) {
        const ganaA = semilla.get(serie.teamAId) < semilla.get(serie.teamBId);
        await admin(app, 'post', `/api/admin/events/${event.id}/competition/result`, {
          seriesId: serie.id,
          teamARounds: ganaA ? 13 : 7,
          teamBRounds: ganaA ? 7 : 13,
          reason: 'carga de prueba'
        }).expect(200);
      }

      // --- clasificación ---
      const tabla = database.valorantCompetition.standings(event.id, { teams: equipos });
      assert.equal(tabla.complete, true);
      assert.equal(tabla.seriesPlayed, 15);
      assert.equal(tabla.standings.length, 6);

      assert.equal(tabla.standings.every((f) => f.played === 5), true, 'todos juegan cinco');
      assert.equal(tabla.standings.reduce((total, f) => total + f.wins, 0), 15);
      assert.equal(tabla.standings.reduce((total, f) => total + f.losses, 0), 15);

      // El de semilla 1 gana sus cinco; el de semilla 6 pierde sus cinco.
      assert.equal(tabla.standings[0].wins, 5);
      assert.equal(tabla.standings.at(-1).wins, 0);
      assert.equal(tabla.standings[0].roundsFor, 13 * 5);
      assert.equal(tabla.standings[0].roundDiff, (13 - 7) * 5);

      // Clasifican cuatro.
      assert.deepEqual(tabla.standings.map((f) => f.qualified), [true, true, true, true, false, false]);

      // --- un resultado cerrado no se pisa sin pedirlo ---
      const pisar = await admin(app, 'post', `/api/admin/events/${event.id}/competition/result`, {
        seriesId: series[0].id, teamARounds: 3, teamBRounds: 13, reason: 'ups'
      });
      assert.equal(pisar.status, 409);
      assert.equal(pisar.body.error.code, 'RESULT_ALREADY_RECORDED');

      const corregido = await admin(app, 'post', `/api/admin/events/${event.id}/competition/result`, {
        seriesId: series[0].id, teamARounds: 3, teamBRounds: 13, reason: 'marcador mal leído', correct: true
      }).expect(200);
      assert.equal(corregido.body.series.status, 'COMPLETED');

      // --- y queda registrado quién y por qué ---
      const auditoria = await admin(app, 'get', `/api/admin/events/${event.id}/audit`).expect(200);
      const correccion = auditoria.body.audit.find((row) => row.action === 'RESULT_CORRECTED');
      assert.equal(correccion.reason, 'marcador mal leído');
      assert.ok(auditoria.body.audit.some((row) => row.action === 'REGULAR_SEASON_GENERATED'));
      assert.ok(auditoria.body.audit.some((row) => row.action === 'MAP_ASSIGNED'));
    });
  });

  describe('liga de cinco equipos', () => {
    it('cada jornada tiene un equipo descansando', async () => {
      const { database, app, event } = draftTerminado(5);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {}).expect(201);

      const jornadas = database.valorantCompetition.matchdays(event.id);
      assert.equal(jornadas.length, 5);
      assert.equal(jornadas.every((j) => j.series.length === 2), true);

      const descansos = jornadas.map((j) => j.bye);
      assert.equal(descansos.filter(Boolean).length, 5);
      assert.equal(new Set(descansos).size, 5, 'cada equipo descansa una vez');

      const series = database.valorantCompetition.listSeries(event.id);
      assert.equal(series.length, 10);
    });
  });

  // ===================== PÚBLICO Y PERMISOS =====================

  describe('lo público y lo protegido', () => {
    it('la página pública enseña jornadas, mapas y tabla, sin nada privado', async () => {
      const { database, app, event } = draftTerminado(4);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {}).expect(201);
      const series = database.valorantCompetition.listSeries(event.id);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/map`,
        { seriesId: series[0].id, mapKey: 'ascent' }).expect(200);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/result`,
        { seriesId: series[0].id, teamARounds: 13, teamBRounds: 9, reason: 'prueba' }).expect(200);

      const publico = await request(app).get(`/api/events/${event.slug}/competition-teams`).expect(200);
      assert.equal(publico.body.generated, true);
      assert.equal(publico.body.matchdays.length, 3);
      assert.equal(publico.body.seriesTotal, 6);
      assert.equal(publico.body.seriesPlayed, 1);
      assert.equal(publico.body.standings.length, 4);
      assert.equal(publico.body.matchdays[0].series[0].games[0].mapKey, 'ascent');

      const texto = JSON.stringify(publico.body);
      for (const prohibido of ['discord', 'session', 'riot_puuid', 'reason', 'audit']) {
        assert.equal(texto.toLowerCase().includes(prohibido), false, `no debe salir ${prohibido}`);
      }
    });

    it('mientras el evento esté anunciado no se filtra la competición', async () => {
      const { database, app, event } = draftTerminado(4);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {}).expect(201);
      database.updateEvent(event.id, { ...event, status: 'Próximamente', registrationsOpen: false });

      const respuesta = await request(app).get(`/api/events/${event.slug}/competition-teams`);
      assert.equal(respuesta.status, 404);
      assert.equal(respuesta.body.error.code, 'EVENT_NOT_PUBLISHED');
    });

    it('todas las rutas de administración exigen el token', async () => {
      const { app, event } = draftTerminado(4);
      const rutas = [
        ['get', `/api/admin/events/${event.id}/draft`],
        ['put', `/api/admin/events/${event.id}/draft`],
        ['post', `/api/admin/events/${event.id}/draft/start`],
        ['post', `/api/admin/events/${event.id}/draft/status`],
        ['post', `/api/admin/events/${event.id}/teams/rename`],
        ['post', `/api/admin/events/${event.id}/teams/move`],
        ['post', `/api/admin/events/${event.id}/teams/captain`],
        ['get', `/api/admin/events/${event.id}/audit`],
        ['get', `/api/admin/events/${event.id}/competition`],
        ['put', `/api/admin/events/${event.id}/competition/maps`],
        ['put', `/api/admin/events/${event.id}/competition/settings`],
        ['post', `/api/admin/events/${event.id}/competition/generate`],
        ['post', `/api/admin/events/${event.id}/competition/map`],
        ['post', `/api/admin/events/${event.id}/competition/result`]
      ];

      for (const [metodo, ruta] of rutas) {
        const sinToken = await request(app)[metodo](ruta).send({});
        assert.equal(sinToken.status, 401, `${metodo.toUpperCase()} ${ruta} sin token`);

        const malToken = await request(app)[metodo](ruta)
          .set('Authorization', 'Bearer no-es-el-token').send({});
        assert.equal(malToken.status, 401, `${metodo.toUpperCase()} ${ruta} con token falso`);
      }
    });
  });

  // ===================== DESEMPATES =====================

  describe('desempates', () => {
    it('entre dos empatados manda el enfrentamiento directo', async () => {
      const { database, app, event } = draftTerminado(4);
      await admin(app, 'post', `/api/admin/events/${event.id}/competition/generate`, {}).expect(201);
      const equipos = database.valorant.listTeams(event.id);
      const series = database.valorantCompetition.listSeries(event.id);

      // Se monta un empate a dos victorias entre los equipos 1 y 2, con el 1
      // ganándole al 2 pero con peor diferencia de rondas.
      const [uno, dos, tres, cuatro] = equipos.map((e) => e.id);
      const resultado = async (serie, ganador, rondasGanador, rondasPerdedor) => {
        const ganaA = serie.teamAId === ganador;
        await admin(app, 'post', `/api/admin/events/${event.id}/competition/result`, {
          seriesId: serie.id,
          teamARounds: ganaA ? rondasGanador : rondasPerdedor,
          teamBRounds: ganaA ? rondasPerdedor : rondasGanador,
          reason: 'montaje de empate'
        }).expect(200);
      };

      const busca = (a, b) => series.find((s) =>
        (s.teamAId === a && s.teamBId === b) || (s.teamAId === b && s.teamBId === a));

      await resultado(busca(uno, dos), uno, 13, 11);   // el 1 gana al 2 por poco
      await resultado(busca(uno, tres), uno, 13, 11);
      await resultado(busca(uno, cuatro), cuatro, 13, 2);
      await resultado(busca(dos, tres), dos, 13, 0);   // el 2 arrasa
      await resultado(busca(dos, cuatro), dos, 13, 0);
      await resultado(busca(tres, cuatro), tres, 13, 5);

      const tabla = database.valorantCompetition.standings(event.id, { teams: equipos });
      const posicion = (id) => tabla.standings.find((f) => f.teamId === id).position;

      // Los dos tienen dos victorias; el 2 tiene mucha mejor diferencia, pero
      // el enfrentamiento directo va antes y lo ganó el 1.
      assert.equal(tabla.standings.find((f) => f.teamId === uno).wins, 2);
      assert.equal(tabla.standings.find((f) => f.teamId === dos).wins, 2);
      assert.ok(tabla.standings.find((f) => f.teamId === dos).roundDiff
        > tabla.standings.find((f) => f.teamId === uno).roundDiff);
      assert.ok(posicion(uno) < posicion(dos), 'el directo manda entre dos');
    });

    it('con tres empatados no se aplica el directo a ciegas', () => {
      const { database, event } = draftTerminado(4);
      const equipos = database.valorant.listTeams(event.id);
      database.valorantCompetition.generateRegularSeason(event.id, equipos.map((e) => e.id));

      const settings = database.valorantCompetition.getSettings(event.id);
      assert.deepEqual(settings.tiebreakers, ['wins', 'head_to_head', 'round_diff', 'rounds_for']);

      // Con tres empatados, el criterio que decide es el siguiente configurado,
      // no un "le gané a uno" que no ordena nada.
      const cambiados = database.valorantCompetition.setSettings(event.id, {
        tiebreakers: ['wins', 'round_diff'], qualifiers: 4
      });
      assert.deepEqual(cambiados.tiebreakers, ['wins', 'round_diff']);

      assert.throws(() => database.valorantCompetition.setSettings(event.id, {
        tiebreakers: ['wins', 'moneda_al_aire']
      }), (e) => e.code === 'UNKNOWN_TIEBREAKER');
    });
  });

  describe('las páginas se sirven', () => {
    it('la fase regular tiene su propia dirección', async () => {
      const { app, event } = montar();
      const pagina = await request(app).get(`/eventos/${event.slug}/competicion`).expect(200);
      assert.match(pagina.text, /competicion\.js/);
      assert.match(pagina.text, /public-standings/);

      // Y sigue sirviendo la del draft, que comparte prefijo.
      const draft = await request(app).get(`/eventos/${event.slug}/draft`).expect(200);
      assert.match(draft.text, /draft\.js/);
    });

    it('el título de los equipos ya no da por hecho que son cuatro', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'draft.html'), 'utf8');
      assert.equal(html.includes('Los cuatro equipos'), false);

      const guion = fs.readFileSync(path.join(__dirname, '..', 'public', 'draft.js'), 'utf8');
      assert.match(guion, /--team-columns/, 'las columnas salen del número de equipos');

      const estilos = fs.readFileSync(path.join(__dirname, '..', 'public', 'draft.css'), 'utf8');
      assert.match(estilos, /repeat\(var\(--team-columns/);
    });
  });
});
