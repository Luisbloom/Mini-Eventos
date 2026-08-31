'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const BetterSqlite3 = require('better-sqlite3');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const {
  OFFICIAL_VALORANT_FORMAT,
  officialValorantFormatForSlug
} = require('../src/valorant-event-format');

describe('formato oficial del torneo de Valorant', () => {
  const directories = [];
  const databases = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => { try { database.close(); } catch { /* cerrada */ } });
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  function databasePath() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-pdf-sync-'));
    directories.push(directory);
    return path.join(directory, 'tournament.db');
  }

  function createOfficialEvent(database, overrides = {}) {
    return database.createEvent({
      slug: 'torneo-valorant', name: 'Torneo de Valorant', game: 'Valorant',
      description: 'Formato oficial', status: 'Inscripciones abiertas', registrationsOpen: true,
      minParticipants: 30, maxParticipants: 30,
      modules: { information: true, participants: true, matches: true, registration: true, competition: true, draft: true },
      accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/valorant-cover.jpg',
      ...overrides
    });
  }

  it('representa exactamente 20 jugadores, 4 equipos, 4 capitanes y 16 elecciones', () => {
    const format = officialValorantFormatForSlug('torneo-valorant');
    assert.equal(format, OFFICIAL_VALORANT_FORMAT);
    assert.deepEqual({
      players: format.players,
      teams: format.teams,
      teamSize: format.teamSize,
      captains: format.captains,
      picks: format.draftPicks,
      rrSeries: format.regularSeason.series,
      rrPerTeam: format.regularSeason.seriesPerTeam,
      matchdays: format.regularSeason.matchdays,
      bestOf: format.regularSeason.bestOf,
      playoffTeams: format.playoffs.teams,
      playoffBestOf: format.playoffs.bestOf,
      grandFinalBestOf: format.playoffs.grandFinalBestOf,
      reset: format.playoffs.grandFinalReset
    }, {
      players: 20, teams: 4, teamSize: 5, captains: 4, picks: 16,
      rrSeries: 6, rrPerTeam: 3, matchdays: 3, bestOf: 1,
      playoffTeams: 4, playoffBestOf: 3, grandFinalBestOf: 3, reset: true
    });
    assert.equal(officialValorantFormatForSlug('otro-valorant'), null);
  });

  it('sincroniza una vez el evento real, cierra inscripciones y conserva los 23 de Among Us', async () => {
    const dbPath = databasePath();
    let database = openDatabase(dbPath);
    for (let index = 1; index <= 23; index += 1) {
      database.createParticipant(database.getDefaultEvent().id, {
        discord_username: `among${index}`,
        game_name: `Among ${index}`,
        friend_code: `among${index}#${String(1000 + index)}`
      });
    }
    createOfficialEvent(database);
    database.close();

    // Simula la base de producción creada antes de que existiera esta versión
    // de la especificación oficial.
    const legacy = new BetterSqlite3(dbPath);
    legacy.prepare("DELETE FROM app_settings WHERE setting_key LIKE 'event_format:torneo-valorant:%'").run();
    legacy.close();

    database = openDatabase(dbPath);
    databases.push(database);
    const event = database.getEventBySlug('torneo-valorant');
    assert.equal(event.status, 'Próximamente');
    assert.equal(event.archived, false);
    assert.equal(event.registrationsOpen, false);
    assert.equal(event.minParticipants, 20);
    assert.equal(event.maxParticipants, 20);
    assert.equal(event.participantCount, 0);
    assert.equal(database.getDefaultEvent().participantCount, 23);

    const app = createApp({ database, adminToken: 'admin-test' });
    const detail = await request(app).get('/api/events/torneo-valorant').expect(200);
    assert.equal(detail.body.event.officialFormat.players, 20);
    assert.equal(detail.body.event.registration.available, false);
    assert.match(detail.body.event.officialFormat.public.maps, /los decide la organización/);
    const blocked = await request(app).post('/api/events/torneo-valorant/registrations')
      .send({ values: { discord_username: 'nadie', game_name: 'Nadie' }, acceptedTerms: true }).expect(404);
    assert.equal(blocked.body.error.code, 'REGISTRATION_FLOW_UNAVAILABLE');

    // La sincronización es una migración, no un proceso que vuelva a pisar
    // decisiones futuras de la organización en cada arranque.
    database.updateEvent(event.id, { status: 'En curso' });
    database.close();
    database = openDatabase(dbPath);
    databases.push(database);
    assert.equal(database.getEventBySlug('torneo-valorant').status, 'En curso');
    assert.equal(database.getDefaultEvent().participantCount, 23);
  });

  it('publica el evento y todas sus portadas de competición sin inventar datos', async () => {
    const dbPath = databasePath();
    const database = openDatabase(dbPath);
    databases.push(database);
    createOfficialEvent(database, { status: 'Próximamente', registrationsOpen: false });
    const app = createApp({ database, adminToken: 'admin-test' });

    for (const route of [
      '/eventos/torneo-valorant',
      '/eventos/torneo-valorant/competicion',
      '/eventos/torneo-valorant/competicion/draft',
      '/eventos/torneo-valorant/competicion/fase-regular',
      '/eventos/torneo-valorant/competicion/playoffs',
      '/eventos/torneo-valorant/competicion/estadisticas',
      '/eventos/torneo-valorant/competicion/resultados'
    ]) {
      await request(app).get(route).expect(200).expect('Content-Type', /html/);
    }

    const state = await request(app)
      .get('/api/events/torneo-valorant/competition-teams')
      .expect(404);
    assert.equal(state.body.error.code, 'EVENT_NOT_PUBLISHED');

    const event = await request(app).get('/api/events/torneo-valorant').expect(200);
    assert.equal(event.body.event.officialFormat.players, 20);
    assert.equal(event.body.event.participantCount, 0);

    const information = await request(app)
      .get('/api/events/torneo-valorant/tournament-information')
      .expect(200);
    assert.equal(information.body.event.officialFormat.teams, 4);
    assert.match(information.body.event.officialFormat.public.draft, /draft/i);
  });

  it('impide convertir el evento real en una demo de cinco o seis equipos', () => {
    const dbPath = databasePath();
    const database = openDatabase(dbPath);
    databases.push(database);
    const event = createOfficialEvent(database);
    for (const teamCount of [5, 6]) {
      assert.throws(() => database.valorant.configureDraft(event.id, {
        captains: [], teamCount, teamSize: 5
      }), (error) => error.code === 'OFFICIAL_EVENT_FORMAT_MISMATCH');
    }
  });

  it('fija la liga real a cuatro equipos, BO1 y sólo los desempates ya decididos', () => {
    const dbPath = databasePath();
    const database = openDatabase(dbPath);
    databases.push(database);
    const event = createOfficialEvent(database);
    const competition = database.valorantCompetition;

    assert.deepEqual(competition.getSettings(event.id).tiebreakers,
      ['wins', 'head_to_head', 'round_diff']);
    assert.throws(() => competition.setSettings(event.id, {
      tiebreakers: ['wins', 'head_to_head', 'round_diff', 'rounds_for']
    }), (error) => error.code === 'OFFICIAL_TIEBREAKER_NOT_CONFIGURED');
    assert.throws(() => competition.generateRegularSeason(event.id, [1, 2, 3, 4], { bestOf: 3 }),
      (error) => error.code === 'OFFICIAL_REGULAR_FORMAT_MISMATCH');
    assert.throws(() => competition.generateRegularSeason(event.id, [1, 2, 3, 4, 5], { bestOf: 1 }),
      (error) => error.code === 'OFFICIAL_REGULAR_FORMAT_MISMATCH');
  });

  it('no publica el map pool hasta que la organización lo anuncia', () => {
    const dbPath = databasePath();
    const database = openDatabase(dbPath);
    databases.push(database);
    const event = createOfficialEvent(database);

    // Los mapas los elige la organización: no hay veto que configurar, sólo un
    // pool que anunciar. Mientras no se anuncie, no se publica a medias.
    assert.deepEqual(database.valorantCompetition.getMapAnnouncement(event.id), {
      status: 'MAP_POOL_NOT_ANNOUNCED',
      chosenBy: 'ORGANISATION',
      announcedBeforeSeries: true,
      pool: null
    });
    assert.ok(database.valorantCompetition.listMaps(event.id).length > 0,
      'el catálogo manual sigue disponible');

    database.valorantCompetition.setMapPool(event.id, ['ascent', 'bind']);
    const anunciado = database.valorantCompetition.getMapAnnouncement(event.id);
    assert.equal(anunciado.status, 'MAP_POOL_ANNOUNCED');
    assert.deepEqual(anunciado.pool, ['ascent', 'bind']);
  });

  it('las decisiones tomadas dejan de figurar como pendientes', () => {
    const { OFFICIAL_VALORANT_FORMAT: F } = require('../src/valorant-event-format');

    // No se pausa dentro de una partida; entre mapas de una serie, sí hay pausa.
    assert.deepEqual(F.pauses, { duringGame: false, betweenGames: true });
    assert.match(F.public.pauses, /No hay pausas dentro de una partida/);
    assert.ok(!F.pending.some((x) => /pausa/i.test(x)),
      'una regla ya decidida no puede seguir en la lista de pendientes');

    // El map pool se anuncia el mismo día, y el texto público lo dice.
    assert.equal(F.mapPoolAnnouncement, 'TOURNAMENT_DAY');
    assert.match(F.public.maps, /el mismo día del torneo/);

    // Lo que sigue sin decidirse sí debe figurar.
    for (const abierto of ['Fecha', 'Horarios', 'Servidor o región', 'Map pool']) {
      assert.ok(F.pending.includes(abierto), `${abierto} sigue pendiente`);
    }
  });

  it('la pagina de informacion explica TODO lo que el formato declara', () => {
    const { OFFICIAL_VALORANT_FORMAT: F } = require('../src/valorant-event-format');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'information.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');

    /*
      Un texto escrito, revisado y que no pinta nadie es trabajo que no llega a
      existir para quien viene a informarse. Aquí se comprueba que cada texto
      declarado tiene su hueco y alguien que lo escribe.
    */
    const mapa = js.slice(js.indexOf('VALORANT_TEXTOS'), js.indexOf('function renderValorantFormat'));
    for (const clave of Object.keys(F.public)) {
      assert.ok(mapa.includes(`${clave}:`), `el texto "${clave}" no se pinta en ninguna parte`);
      // Se saca el selector sin expresiones regulares: un escape mal puesto en
      // una plantilla hace que la prueba mienta en vez de fallar por lo suyo.
      const desde = mapa.indexOf(`${clave}: '#`) + `${clave}: '#`.length;
      const selector = mapa.slice(desde, mapa.indexOf("'", desde));
      assert.ok(selector, `"${clave}" no tiene selector`);
      assert.ok(html.includes(`id="${selector}"`), `falta el hueco de "${clave}" en el HTML`);
    }
  });

  it('la pagina explica el recorrido del participante y lo que falta por anunciar', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'information.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');

    assert.ok(js.includes('participantJourney'), 'el recorrido paso a paso no se pinta');
    assert.ok(html.includes('id="valorant-info-journey"'));

    // Lo que aún no se sabe se enseña: callarlo no responde la pregunta.
    assert.ok(js.includes('format.pending'), 'los pendientes no se enseñan');
    assert.ok(html.includes('id="valorant-info-pending"'));
  });

  it('el formato oficial ya no promete un veto que no existe', () => {
    const { OFFICIAL_VALORANT_FORMAT } = require('../src/valorant-event-format');
    assert.equal(OFFICIAL_VALORANT_FORMAT.maps.chosenBy, 'ORGANISATION');
    assert.equal(OFFICIAL_VALORANT_FORMAT.veto, undefined);
    const texto = JSON.stringify(OFFICIAL_VALORANT_FORMAT.public);
    assert.ok(!/veto de mapas/i.test(texto), 'el texto público no puede prometer un veto');
    assert.ok(!OFFICIAL_VALORANT_FORMAT.pending.some((x) => /veto/i.test(x)));
  });
});
