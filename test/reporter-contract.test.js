'use strict';

// Mitad de Node del contrato con JartiTournamentReporter. Los archivos de
// reporter/contract los genera la suite de C# (UPDATE_CONTRACT=1) y los replica
// aquí el backend real: si el mod cambia el formato del resultado o el backend
// cambia el del contexto, este archivo falla antes de que se note en un torneo.

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { buildLeaderboard } = require('../src/leaderboard');
const {
  CONTEXT_FIXTURE,
  PAYLOAD_FIXTURE,
  HOST_TOKEN,
  seedContractDatabase
} = require('./helpers/reporter-contract-fixture');

describe('Reporter contract', () => {
  let directory, database, app, event, payload;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-reporter-contract-'));
    ({ database, event } = seedContractDatabase(path.join(directory, 'tournament.db')));
    app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test', reporterToken: 'legacy-test' });
    payload = fs.readFileSync(PAYLOAD_FIXTURE, 'utf8');
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const send = (body) => request(app)
    .post(`/api/events/${event.slug}/matches`)
    .set('Authorization', `Bearer ${HOST_TOKEN}`)
    .set('Content-Type', 'application/json')
    .send(body);

  it('returns exactly the context the Reporter is compiled against', async () => {
    const expected = JSON.parse(fs.readFileSync(CONTEXT_FIXTURE, 'utf8'));
    const response = await request(app).get('/api/reporter/context')
      .set('Authorization', `Bearer ${HOST_TOKEN}`)
      .set('X-Host-Id', 'HOST_1')
      .expect(200);

    const { serverTime, ...actual } = response.body;
    assert.ok(serverTime, 'la respuesta debe incluir serverTime');
    assert.deepEqual(actual, expected);
  });

  it('accepts the exact bytes the Reporter serializes', async () => {
    const created = await send(payload).expect(201);

    assert.equal(created.body.result.reportId, 'HOST_1-550e8400-e29b-41d4-a716-446655440000');
    assert.equal(created.body.result.winner, 'impostor');
    assert.equal(created.body.result.gameMode, 'standard');
    assert.equal(created.body.result.playerCount, 4);
    assert.equal(created.body.stageId, 1);
    assert.equal(created.body.groupId, 1);
    assert.equal(created.body.matchNumber, 1);
    assert.equal(database.countMatches(event.id), 1);
  });

  it('treats an identical retry as the same match instead of a duplicate', async () => {
    const created = await send(payload).expect(201);
    const replay = await send(payload).expect(200);

    assert.equal(replay.body.id, created.body.id);
    assert.equal(replay.body.duplicate, true);
    assert.equal(database.countMatches(event.id), 1);
  });

  it('scores the match from raw data without the Reporter sending any points', async () => {
    assert.equal(payload.includes('"points"'), false);
    assert.equal(payload.includes('"score"'), false);
    await send(payload).expect(201);

    const { standings } = buildLeaderboard(database.listAllMatches(event.id));
    const points = Object.fromEntries(standings.map((row) => [row.name, row.points]));

    // Impostor ganador: 5 de victoria + 2 kills capadas a 3 = 7.
    // Marta muere y termina sus tareas como fantasma: pierde (0) pero conserva
    // el +1 por completarlas, que es justo lo que el Reporter debe capturar.
    assert.equal(points.Luis, 7);
    assert.equal(points.Marta, 1);
    assert.equal(points.Nacho, 0);
    assert.equal(points.Sara, 0);
  });

  it('rewards the crew win and the all-tasks bonus with the same payload shape', async () => {
    const crewWin = JSON.parse(payload);
    crewWin.reportId = 'HOST_1-crew-win';
    crewWin.winner = 'crew';
    crewWin.players.forEach((player) => { player.won = player.team === 'crew'; });
    crewWin.players[0].kills = 0;

    await send(crewWin).expect(201);

    const points = Object.fromEntries(
      buildLeaderboard(database.listAllMatches(event.id)).standings.map((row) => [row.name, row.points])
    );
    assert.equal(points.Marta, 5); // 4 de victoria + 1 por completar todas las tareas
    assert.equal(points.Nacho, 4);
    assert.equal(points.Luis, 0);
  });

  it('never republishes the Friend Codes the Reporter sends', async () => {
    await send(payload).expect(201);

    const matches = await request(app).get(`/api/events/${event.slug}/matches`).expect(200);
    const leaderboard = await request(app).get(`/api/events/${event.slug}/leaderboard`).expect(200);
    const stored = JSON.stringify(database.listAllMatches(event.id));

    for (const body of [JSON.stringify(matches.body), JSON.stringify(leaderboard.body), stored]) {
      assert.equal(body.includes('luis#1001'), false);
      assert.equal(body.includes('marta#1002'), false);
      assert.equal(body.includes('sara#1004'), false);
    }
    assert.equal(JSON.stringify(matches.body).includes(HOST_TOKEN), false);
  });

  it('refuses a second result for the same slot with a different identifier', async () => {
    await send(payload).expect(201);

    const other = JSON.parse(payload);
    other.reportId = 'HOST_1-otro-intento';
    const conflict = await send(other).expect(409);

    assert.equal(conflict.body.error.code, 'MATCH_SLOT_OCCUPIED');
    assert.equal(database.countMatches(event.id), 1);
  });

  it('refuses the same identifier carrying different content', async () => {
    await send(payload).expect(201);

    const tampered = JSON.parse(payload);
    tampered.players[0].kills = 9;
    const conflict = await send(tampered).expect(409);

    assert.equal(conflict.body.error.code, 'REPORT_ID_CONFLICT');
  });

  it('rejects the payload when the credential or the host is wrong', async () => {
    await request(app).post(`/api/events/${event.slug}/matches`)
      .set('Authorization', `Bearer jtr_${'X'.repeat(43)}`)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(401);

    const impersonated = JSON.parse(payload);
    impersonated.hostId = 'HOST_2';
    await send(impersonated).expect(403)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_MISMATCH'));
  });
});
