'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');
const {
  ADMIN_TOKEN,
  EVENT_SLUG,
  seedValorantDemo
} = require('../tools/demo/valorant-visual-demo');

describe('demo visual reproducible de Valorant', () => {
  const directories = [];
  const databases = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it('expone draft, liga completa, clasificación, estadísticas y playoffs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-visual-demo-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'demo.db');

    const summary = seedValorantDemo(dbPath);
    assert.deepEqual({
      participants: summary.participants,
      draft: summary.draft,
      teams: summary.teams,
      regularSeries: summary.regularSeries,
      regularCompleted: summary.regularCompleted,
      standings: summary.standings,
      qualified: summary.qualified,
      playoffsGenerated: summary.playoffsGenerated,
      playoffCompleted: summary.playoffCompleted
    }, {
      participants: 30,
      draft: 'COMPLETED',
      teams: 6,
      regularSeries: 15,
      regularCompleted: 15,
      standings: 6,
      qualified: 4,
      playoffsGenerated: true,
      playoffCompleted: 2
    });
    assert.ok(summary.playoffSeries >= 6);

    const database = openDatabase(dbPath);
    databases.push(database);
    const app = createApp({ database, adminToken: ADMIN_TOKEN });

    const publicState = await request(app)
      .get(`/api/events/${EVENT_SLUG}/competition-teams`)
      .expect(200);
    assert.equal(publicState.body.teams.length, 6);
    assert.equal(publicState.body.seriesTotal, 15);
    assert.equal(publicState.body.seriesPlayed, 15);
    assert.equal(publicState.body.standings.length, 6);
    assert.equal(publicState.body.playerStats.length, 30);
    assert.equal(publicState.body.playoffs.generated, true);
    assert.ok(publicState.body.playoffs.series.length >= 6);

    const slots = new Map(publicState.body.playoffs.series.map((series) => [series.slot, series]));
    assert.equal(slots.get('UPPER_SEMI_1').status, 'COMPLETED');
    assert.equal(slots.get('UPPER_SEMI_2').status, 'COMPLETED');
    assert.ok(slots.get('UPPER_FINAL').teamA);
    assert.ok(slots.get('UPPER_FINAL').teamB);
    assert.ok(slots.get('LOWER_ROUND_1').teamA);
    assert.ok(slots.get('LOWER_ROUND_1').teamB);

    const adminState = await request(app)
      .get(`/api/admin/events/${summary.eventId}/competition`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);
    assert.equal(adminState.body.draft.status, 'COMPLETED');
  });
});
