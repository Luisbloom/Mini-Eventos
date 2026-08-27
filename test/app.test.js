'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');

const silentLogger = { info() {}, error() {} };

describe('Jartiland Among Us API', () => {
  let temporaryDirectory;
  let dbPath;
  let database;
  let app;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-amongus-'));
    dbPath = path.join(temporaryDirectory, 'nested', 'tournament.db');
    database = openDatabase(dbPath);
    app = createApp({ database, logger: silentLogger });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('serves the Mini Eventos portal', async () => {
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.text, /MINI EVENTOS JARTILAND/);
  });

  it('serves the global profile page', async () => {
    const response = await request(app).get('/perfil');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.text, /id="profile-main"/);
    assert.match(response.text, /id="profile-avatar-image"/);
    assert.match(response.text, /src="\/profile\.js"/);
  });

  it('keeps one global profile entry in every public topbar', async () => {
    const routes = [
      '/',
      '/eventos/among-us-agosto-2026',
      '/eventos/among-us-agosto-2026/informacion',
      '/eventos/torneo-valorant/competicion',
      '/eventos/torneo-valorant/competicion/draft'
    ];
    for (const route of routes) {
      const response = await request(app).get(route).expect(200);
      assert.equal((response.text.match(/href="\/perfil"/g) || []).length, 1, route);
    }
  });

  it('serves the public information and administration pages', async () => {
    const information = await request(app).get('/informacion');
    assert.equal(information.status, 302);
    assert.equal(information.headers.location, '/eventos/among-us-agosto-2026/informacion');

    const admin = await request(app).get('/admin');
    assert.equal(admin.status, 200);
    assert.match(admin.text, /Administración/i);
  });

  it('reports API and database health', async () => {
    const response = await request(app).get('/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.database, 'ok');
    assert.equal(typeof response.body.uptimeSeconds, 'number');
  });

  it('stores a report and returns it through both read endpoints', async () => {
    const report = {
      reportId: 'round-2026-08-21-001',
      map: 'The Skeld',
      winner: 'crewmates',
      players: [{ name: 'Rojo', role: 'Crewmate' }]
    };

    const created = await request(app)
      .post('/api/matches')
      .set('Content-Type', 'application/json')
      .send(report);

    assert.equal(created.status, 201);
    assert.equal(created.body.result.reportId, report.reportId);
    assert.equal(created.body.result.map, 'The Skeld');
    assert.equal(created.body.id, 1);
    assert.match(created.headers.location, /^\/api\/matches\/1$/);

    const list = await request(app).get('/api/matches');
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.matches[0].result.map, report.map);

    const detail = await request(app).get('/api/matches/1');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.result.map, report.map);
  });

  it('keeps reports after the database is closed and reopened', async () => {
    await request(app).post('/api/matches').send({ map: 'Polus', winner: 'impostors' });
    database.close();

    database = openDatabase(dbPath);
    app = createApp({ database, logger: silentLogger });
    const response = await request(app).get('/api/matches');

    assert.equal(response.body.count, 1);
    assert.equal(response.body.matches[0].result.map, 'Polus');
  });

  it('returns reports newest first and caps the requested limit', async () => {
    for (let index = 1; index <= 3; index += 1) {
      await request(app).post('/api/matches').send({ reportId: `sequence-${index}`, sequence: index });
    }

    const limited = await request(app).get('/api/matches?limit=2');
    assert.deepEqual(limited.body.matches.map((match) => match.result.reportId), ['sequence-3', 'sequence-2']);

    const capped = await request(app).get('/api/matches?limit=500');
    assert.equal(capped.body.limit, 100);
  });

  it('exposes an aggregated public leaderboard', async () => {
    await request(app).post('/api/matches').send({
      players: [
        { playerId: 'luna', name: 'Luna', points: 4, won: true, kills: 2 },
        { playerId: 'sol', name: 'Sol', points: 2, won: false, kills: 1 }
      ]
    });
    await request(app).post('/api/matches').send({
      players: [
        { playerId: 'luna', name: 'Luna', points: 1, won: false, kills: 0 },
        { playerId: 'sol', name: 'Sol', points: 5, won: true, kills: 3 }
      ]
    });

    const response = await request(app).get('/api/leaderboard');

    assert.equal(response.status, 200);
    assert.equal(response.body.matchCount, 2);
    assert.deepEqual(response.body.standings.map((player) => player.name), ['Sol', 'Luna']);
    assert.deepEqual(response.body.standings.map((player) => player.points), [7, 5]);
  });

  it('publishes tournament information with canonical scoring rules', async () => {
    const response = await request(app).get('/api/tournament-information');

    assert.equal(response.status, 200);
    assert.equal(response.body.information.rules.length, 10);
    assert.equal(response.body.scoring.config.crewWin, 4);
    assert.equal(response.body.scoring.config.impostorWin, 5);
    assert.equal(response.body.scoring.rules[2].maximum, 3);
  });

  it('requires a configured administrator token', async () => {
    const response = await request(app)
      .put('/api/admin/tournament-information')
      .send({ information: database.getTournamentInformation().information });

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'ADMIN_NOT_CONFIGURED');
  });

  it('protects, validates and persists administrator updates', async () => {
    app = createApp({ database, logger: silentLogger, adminToken: 'test-secret-value' });
    const information = database.getTournamentInformation().information;
    information.general.intro = 'Nueva introducción visible para participantes.';

    const unauthorized = await request(app)
      .put('/api/admin/tournament-information')
      .set('Authorization', 'Bearer incorrecto')
      .send({ information });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error.code, 'ADMIN_UNAUTHORIZED');

    const invalid = structuredClone(information);
    invalid.rules = [];
    const rejected = await request(app)
      .put('/api/admin/tournament-information')
      .set('Authorization', 'Bearer test-secret-value')
      .send({ information: invalid });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, 'INVALID_TOURNAMENT_INFORMATION');

    const saved = await request(app)
      .put('/api/admin/tournament-information')
      .set('Authorization', 'Bearer test-secret-value')
      .send({ information });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.information.general.intro, information.general.intro);

    const publicResponse = await request(app).get('/api/tournament-information');
    assert.equal(publicResponse.body.information.general.intro, information.general.intro);
  });

  for (const invalidBody of [[], {}, 'texto']) {
    it(`rejects an invalid report body: ${JSON.stringify(invalidBody)}`, async () => {
      const response = await request(app).post('/api/matches').send(invalidBody);

      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'INVALID_REPORT');
    });
  }

  it('rejects malformed JSON with a stable error response', async () => {
    const response = await request(app)
      .post('/api/matches')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_JSON');
  });

  it('rejects reports larger than 1 MB', async () => {
    const response = await request(app)
      .post('/api/matches')
      .send({ payload: 'x'.repeat(1024 * 1024) });

    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'REPORT_TOO_LARGE');
  });

  it('rejects an invalid list limit', async () => {
    const response = await request(app).get('/api/matches?limit=zero');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_LIMIT');
  });

  it('returns JSON errors for missing API resources and matches', async () => {
    const missingMatch = await request(app).get('/api/matches/999');
    assert.equal(missingMatch.status, 404);
    assert.equal(missingMatch.body.error.code, 'MATCH_NOT_FOUND');

    const missingRoute = await request(app).get('/api/unknown');
    assert.equal(missingRoute.status, 404);
    assert.equal(missingRoute.body.error.code, 'API_NOT_FOUND');
  });
});
