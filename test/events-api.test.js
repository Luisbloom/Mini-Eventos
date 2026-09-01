'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');

const logger = { info() {}, error() {} };
const token = 'events-admin-test-token';

describe('Mini Eventos API', () => {
  let directory;
  let database;
  let app;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-events-api-'));
    database = openDatabase(path.join(directory, 'tournament.db'));
    app = createApp({ database, logger, adminToken: token });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function admin(method, url) {
    return request(app)[method](url).set('Authorization', `Bearer ${token}`);
  }

  it('lists the migrated Among Us event and exposes its modules and fields', async () => {
    const list = await request(app).get('/api/events');
    assert.equal(list.status, 200);
    assert.equal(list.body.events[0].slug, 'among-us-agosto-2026');
    assert.equal(list.body.events[0].minParticipants, 20);
    assert.equal(list.body.events[0].coverImage, '/images/events/among-us-cover.jpg');

    const detail = await request(app).get('/api/events/among-us-agosto-2026');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.event.modules.leaderboard, true);
    assert.deepEqual(detail.body.registrationFields.map((field) => field.key), [
      'discord_username', 'game_name', 'friend_code', 'same_as_discord'
    ]);
  });

  it('creates an event through admin and keeps archived events out of the portal', async () => {
    const unauthorized = await request(app).get('/api/admin/events');
    assert.equal(unauthorized.status, 401);

    const created = await admin('post', '/api/admin/events').send({
      name: 'Noche Minecraft',
      slug: 'minecraft-noche-2026',
      game: 'Minecraft',
      description: 'Un evento de construcción.',
      status: 'Inscripciones abiertas',
      registrationsOpen: true,
      minParticipants: 8,
      maxParticipants: 16,
      coverImage: '/images/events/default-event-cover.png',
      modules: { leaderboard: false, matches: false, registration: true, participants: true, information: true },
      accentColor: '#5bddf1',
      icon: 'blocks'
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.event.slug, 'minecraft-noche-2026');
    assert.equal(created.body.event.minParticipants, 8);

    const genericInformation = await request(app).get('/api/events/minecraft-noche-2026/tournament-information');
    assert.equal(genericInformation.status, 200);
    assert.equal(genericInformation.body.scoring, null);
    assert.match(genericInformation.body.information.general.intro, /Minecraft/);

    const archived = await admin('delete', `/api/admin/events/${created.body.event.id}`);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.event.archived, true);

    const publicList = await request(app).get('/api/events');
    assert.equal(publicList.body.events.some((event) => event.slug === 'minecraft-noche-2026'), false);
    const adminList = await admin('get', '/api/admin/events');
    assert.equal(adminList.body.events.some((event) => event.slug === 'minecraft-noche-2026'), true);
  });

  /** Inscribirse exige Discord: cada quien va con su sesión. */
  const sesion = (nombre) => {
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: `api-${nombre}`, username: nombre, displayName: nombre
    });
    return `jarti_session=${database.valorant.createSession(cuenta.id)}`;
  };

  it('validates a fast registration and never exposes Discord or Friend Code publicly', async () => {
    const created = await request(app)
      .post('/api/events/among-us-agosto-2026/registrations')
      .set('Cookie', sesion('Luis'))
      .send({ values: { game_name: '', friend_code: 'luis#1001', same_as_discord: true }, acceptedTerms: true });
    assert.equal(created.status, 201);
    assert.equal(created.body.participant.displayName, 'Luis');
    assert.equal(created.body.participant.discordUsername, undefined);

    // La misma cuenta otra vez: el duplicado lo detecta la identidad, no el
    // texto que se escriba.
    const duplicate = await request(app)
      .post('/api/events/among-us-agosto-2026/registrations')
      .set('Cookie', sesion('Luis'))
      .send({ values: { game_name: 'Pelusero', friend_code: 'luis#1002' }, acceptedTerms: true });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'ALREADY_REGISTERED');

    const participants = await admin('get', '/api/admin/events/1/participants');
    const id = participants.body.participants[0].id;
    await admin('patch', `/api/admin/participants/${id}`)
      .send({ status: 'confirmed', internalFriendCode: 'ABCDEF#1' })
      .expect(200);

    const publicParticipants = await request(app).get('/api/events/among-us-agosto-2026/participants');
    assert.equal(publicParticipants.body.participants[0].displayName, 'Luis');
    assert.equal(publicParticipants.body.participants[0].discordUsername, undefined);
    assert.equal(publicParticipants.body.participants[0].internalFriendCode, undefined);
  });

  it('scopes Reporter matches and leaderboard while preserving legacy endpoints', async () => {
    const event = await admin('post', '/api/admin/events').send({
      name: 'Valorant Flash', slug: 'valorant-flash', game: 'Valorant', description: '',
      registrationsOpen: false, modules: { leaderboard: true, matches: true }
    });
    await request(app).post('/api/matches').send({
      players: [{ name: 'AmongPlayer', points: 4 }]
    }).expect(201);
    await request(app).post('/api/events/valorant-flash/matches').send({
      players: [{ name: 'ValorantPlayer', points: 9 }]
    }).expect(201);

    const among = await request(app).get('/api/leaderboard');
    const valorant = await request(app).get('/api/events/valorant-flash/leaderboard');
    assert.deepEqual(among.body.standings.map((row) => row.name), ['AmongPlayer']);
    assert.deepEqual(valorant.body.standings.map((row) => row.name), ['ValorantPlayer']);
    assert.notEqual(event.body.event.id, database.getDefaultEvent().id);
  });

  it('returns registration closed and full states with useful status codes', async () => {
    const among = database.getDefaultEvent();
    database.updateEvent(among.id, { minParticipants: 1, maxParticipants: 1 });
    await request(app).post(`/api/events/${among.slug}/registrations`)
      .set('Cookie', sesion('uno'))
      .send({ values: { game_name: 'Uno', friend_code: 'uno#1001' }, acceptedTerms: true }).expect(201);
    const full = await request(app).post(`/api/events/${among.slug}/registrations`)
      .set('Cookie', sesion('dos'))
      .send({ values: { game_name: 'Dos', friend_code: 'dos#1002' }, acceptedTerms: true });
    assert.equal(full.status, 409);
    assert.equal(full.body.error.code, 'REGISTRATION_FULL');

    database.updateEvent(among.id, { maxParticipants: 2, registrationsOpen: false });
    const closed = await request(app).post(`/api/events/${among.slug}/registrations`)
      .set('Cookie', sesion('tres'))
      .send({ values: { game_name: 'Dos', friend_code: 'dos#1002' }, acceptedTerms: true });
    assert.equal(closed.status, 403);
    assert.equal(closed.body.error.code, 'REGISTRATION_CLOSED');
  });

  it('never exposes source IP or full reports and blocks cross-event detail access', async () => {
    const hidden = database.createEvent({
      name: 'Evento privado', slug: 'evento-privado', game: 'Otro', description: '',
      registrationsOpen: false,
      modules: { information: false, participants: false, leaderboard: false, matches: false, registration: false }
    });
    const privateMatch = database.insertMatch({ reportId: 'private-1', internalNote: 'secreto', players: [] }, '10.0.0.44', hidden.id);
    const publicMatch = database.insertMatch({ reportId: 'public-1', map: 'Polus', winner: 'crew', internalNote: 'oculto', players: [{ name: 'Luna', points: 4 }] }, '10.0.0.45');

    await request(app).get(`/api/matches/${privateMatch.id}`).expect(404);
    await request(app).get('/api/events/evento-privado/matches').expect(404);

    const list = await request(app).get('/api/matches');
    assert.equal(list.body.matches[0].sourceIp, undefined);
    assert.equal(list.body.matches[0].report, undefined);
    assert.equal(list.body.matches[0].result.map, 'Polus');
    assert.equal(list.body.matches[0].result.internalNote, undefined);

    const detail = await request(app).get(`/api/matches/${publicMatch.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.sourceIp, undefined);
    assert.equal(detail.body.report, undefined);

    const adminMatches = await admin('get', `/api/admin/events/${database.getDefaultEvent().id}/matches`);
    assert.equal(adminMatches.body.matches[0].sourceIp, '10.0.0.45');
    assert.equal(adminMatches.body.matches[0].report.internalNote, 'oculto');
  });

  it('requires the configured Reporter token and rejects matches for disabled modules', async () => {
    app = createApp({ database, logger, adminToken: token, reporterToken: 'reporter-secret' });
    await request(app).post('/api/matches').send({ reportId: 'unauthorized' }).expect(401);
    const first = await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret').send({ reportId: ' authorized ' }).expect(201);
    const replay = await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret').send({ reportId: 'authorized' }).expect(200);
    assert.equal(replay.body.id, first.body.id);
    await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'authorized', map: 'Polus' })
      .expect(409)
      .expect((response) => assert.equal(response.body.error.code, 'REPORT_ID_CONFLICT'));
    const timed = await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'historical-played-at', playedAt: '2026-08-21T10:00:00.000Z' })
      .expect(201);
    const equivalent = await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'historical-played-at', playedAt: '2026-08-21T12:00:00+02:00' })
      .expect(200);
    assert.equal(equivalent.body.id, timed.body.id);
    await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'historical-played-at', playedAt: '2026-08-21T11:00:00.000Z' })
      .expect(409)
      .expect((response) => assert.equal(response.body.error.code, 'REPORT_ID_CONFLICT'));
    await request(app).post('/api/matches').set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'historical-played-at' })
      .expect(409)
      .expect((response) => assert.equal(response.body.error.code, 'REPORT_ID_CONFLICT'));
    assert.equal(first.body.result.reportId, 'authorized');
    assert.equal(database.countMatches(), 2);

    const hidden = database.createEvent({
      name: 'Sin resultados', slug: 'sin-resultados', game: 'Otro', description: '',
      modules: { information: false, participants: false, leaderboard: false, matches: false, registration: false }
    });
    const rejected = await request(app).post('/api/matches')
      .set('Authorization', 'Bearer reporter-secret')
      .send({ eventSlug: hidden.slug, reportId: 'blocked' });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error.code, 'MATCHES_DISABLED');
  });

  it('never downgrades partial competitive context to a historical match', async () => {
    app = createApp({ database, logger, adminToken: token, reporterToken: 'reporter-secret' });
    const event = database.getDefaultEvent();
    const group = database.competition.listGroups(database.competition.listStages(event.id)[0].id)[0];
    const host = database.competition.listHosts(event.id)[0];

    const historical = await request(app).post('/api/matches')
      .set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'historical-host-attribution', hostId: host.identifier, players: [] })
      .expect(201);
    assert.equal(database.getMatch(historical.body.id).hostId, host.id);

    await request(app).post('/api/matches')
      .set('Authorization', 'Bearer reporter-secret')
      .send({ reportId: 'partial-group-context', groupId: group.id, hostId: host.identifier, matchNumber: 1, players: [] })
      .expect(400)
      .expect((response) => assert.equal(response.body.error.code, 'STAGE_REQUIRED'));
    assert.equal(database.countMatches(event.id), 1);
  });

  it('keeps only historical unauthenticated compatibility when REPORTER_TOKEN is absent', async () => {
    await request(app).post('/api/matches').send({
      reportId: 'legacy-open',
      players: []
    }).expect(201);

    const event = database.getDefaultEvent();
    const stage = database.competition.listStages(event.id)[0];
    database.competition.updateStage(stage.id, { status: 'active' });
    const group = database.competition.listGroups(stage.id)[0];
    const host = database.competition.listHosts(event.id)[0];
    await request(app).post('/api/matches').send({
      reportId: 'competitive-must-be-closed',
      stageId: stage.id,
      groupId: group.id,
      hostId: host.identifier,
      matchNumber: 1,
      players: []
    }).expect(401).expect((response) => {
      assert.equal(response.body.error.code, 'REPORTER_TOKEN_REQUIRED');
    });
  });
});
