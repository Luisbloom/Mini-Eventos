'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');
const { hashReporterToken } = require('../src/services/reporter-auth');

describe('Reporter competitive context', () => {
  let directory, database, app, event, stage, final, groupA, groupB, host1, host2;
  const adminToken = 'admin-test';
  const reporterToken = 'legacy-reporter-test';
  const token1 = `jtr_${'A'.repeat(43)}`;
  const token2 = `jtr_${'B'.repeat(43)}`;
  const admin = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${adminToken}`);
  const context = (token, hostId) => {
    const call = request(app).get('/api/reporter/context').set('Authorization', `Bearer ${token}`);
    return hostId === undefined ? call : call.set('X-Host-Id', hostId);
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-reporter-context-'));
    database = openDatabase(path.join(directory, 'tournament.db'));
    app = createApp({ database, logger: { info() {}, error() {} }, adminToken, reporterToken });
    event = database.getDefaultEvent();
    [stage, final] = database.competition.listStages(event.id);
    database.competition.updateStage(stage.id, { status: 'active' });
    stage = database.competition.getStage(stage.id);
    [groupA, groupB] = database.competition.listGroups(stage.id);
    [host1, host2] = database.competition.listHosts(event.id);
    database.competition.setHostReporterToken(event.id, host1.id, { tokenHash: hashReporterToken(token1) });
    database.competition.setHostReporterToken(event.id, host2.id, { tokenHash: hashReporterToken(token2) });
    database.competition.setHostAssignment(event.id, host1.id, { stageId: stage.id, groupId: groupA.id });
    database.competition.setHostAssignment(event.id, host2.id, { stageId: stage.id, groupId: groupB.id });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function confirmedParticipant(name, friendCode, groupId) {
    const participant = database.createParticipant(event.id, { discord_username: name, game_name: name });
    database.updateParticipant(participant.id, { status: 'confirmed', internalFriendCode: friendCode });
    database.competition.assignParticipant(stage.id, participant.id, groupId);
    return participant;
  }

  it('gives each host only its own stage, group and next match number', async () => {
    const first = await context(token1, 'HOST_1').expect(200);
    assert.equal(first.body.reportingEnabled, true);
    assert.equal(first.body.event.slug, event.slug);
    assert.equal(first.body.host.identifier, 'HOST_1');
    assert.equal(first.body.stage.id, stage.id);
    assert.equal(first.body.stage.type, 'group_stage');
    assert.equal(first.body.group.id, groupA.id);
    assert.equal(first.body.matchNumber, 1);
    assert.equal(first.body.submitPath, `/api/events/${event.slug}/matches`);
    assert.equal(JSON.stringify(first.body).includes(token1), false);

    const second = await context(token2, 'HOST_2').expect(200);
    assert.equal(second.body.group.id, groupB.id);
    assert.equal(second.body.matchNumber, 1);
  });

  it('never lets one host impersonate another or use a legacy credential', async () => {
    await context(token1, 'HOST_2').expect(403)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_MISMATCH'));
    await context(token1).expect(400)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_REQUIRED'));
    await context(reporterToken, 'HOST_1').expect(401)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_TOKEN_REQUIRED'));
    await context(`jtr_${'Z'.repeat(43)}`, 'HOST_1').expect(401)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_TOKEN_INVALID'));
    await request(app).get('/api/reporter/context').set('X-Host-Id', 'HOST_1').expect(401)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_TOKEN_REQUIRED'));
  });

  it('rejects a disabled host and a revoked credential', async () => {
    database.competition.replaceHosts(event.id, [
      { id: host1.id, identifier: host1.identifier, name: host1.name, enabled: false },
      { id: host2.id, identifier: host2.identifier, name: host2.name, enabled: true }
    ]);
    await context(token1, 'HOST_1').expect(403)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_DISABLED'));
    assert.equal(database.competition.getHost(event.id, host1.id).assignedGroupId, groupA.id);

    database.competition.revokeHostReporterToken(event.id, host2.id);
    await context(token2, 'HOST_2').expect(401)
      .expect((response) => assert.equal(response.body.error.code, 'REPORTER_TOKEN_INVALID'));
  });

  it('refuses to guess when the assignment is missing, wrong or the stage is closed', async () => {
    database.competition.setHostAssignment(event.id, host1.id, { stageId: null, groupId: null });
    const unassigned = await context(token1, 'HOST_1').expect(200);
    assert.equal(unassigned.body.reportingEnabled, false);
    assert.equal(unassigned.body.reason, 'HOST_NOT_ASSIGNED');
    assert.equal(unassigned.body.matchNumber, null);

    assert.throws(
      () => database.competition.setHostAssignment(event.id, host1.id, { stageId: stage.id, groupId: null }),
      (error) => error.code === 'GROUP_REQUIRED'
    );
    assert.throws(
      () => database.competition.setHostAssignment(event.id, host1.id, { stageId: final.id, groupId: groupA.id }),
      (error) => error.code === 'STAGE_GROUP_NOT_ALLOWED'
    );
    assert.throws(
      () => database.competition.setHostAssignment(event.id, host1.id, { stageId: stage.id, groupId: groupB.id }),
      (error) => error.code === 'HOST_ASSIGNMENT_CONFLICT'
    );

    database.competition.setHostAssignment(event.id, host1.id, { stageId: final.id, groupId: null });
    const pending = await context(token1, 'HOST_1').expect(200);
    assert.equal(pending.body.reportingEnabled, false);
    assert.equal(pending.body.reason, 'STAGE_NOT_ACTIVE');
    assert.equal(pending.body.stage.id, final.id);
    assert.equal(pending.body.group, null);
  });

  it('advances the match number as valid results arrive and stops at the stage limit', async () => {
    database.competition.updateStage(stage.id, { ...stage, matchesPerGroup: 2 });
    confirmedParticipant('jugador-a', 'AAA#1', groupA.id);
    const send = (reportId, matchNumber) => request(app)
      .post(`/api/events/${event.slug}/matches`)
      .set('Authorization', `Bearer ${token1}`)
      .send({
        reportId,
        hostId: 'HOST_1',
        stageId: stage.id,
        groupId: groupA.id,
        matchNumber,
        playedAt: '2026-08-22T18:30:00.000Z',
        winner: 'crew',
        players: [{ friendCode: 'AAA#1', playerId: 0, team: 'crew', role: 'crew', won: true, kills: 0, tasksCompleted: 4, tasksTotal: 4, allTasksCompleted: true }]
      });

    await send('HOST_1-uuid-1', 1).expect(201);
    const afterFirst = await context(token1, 'HOST_1').expect(200);
    assert.equal(afterFirst.body.matchNumber, 2);
    assert.deepEqual(afterFirst.body.occupiedMatchNumbers, [1]);

    await send('HOST_1-uuid-1', 1).expect(200);
    assert.equal((await context(token1, 'HOST_1')).body.matchNumber, 2);

    await send('HOST_1-uuid-2', 2).expect(201);
    const exhausted = await context(token1, 'HOST_1').expect(200);
    assert.equal(exhausted.body.reportingEnabled, false);
    assert.equal(exhausted.body.reason, 'ALL_MATCHES_PLAYED');

    assert.equal((await context(token2, 'HOST_2')).body.matchNumber, 1);
  });

  it('keeps simultaneous groups independent and refuses an occupied slot', async () => {
    confirmedParticipant('jugador-a', 'AAA#1', groupA.id);
    confirmedParticipant('jugador-b', 'BBB#2', groupB.id);
    const report = (reportId, hostId, groupId, friendCode) => ({
      reportId,
      hostId,
      stageId: stage.id,
      groupId,
      matchNumber: 1,
      playedAt: '2026-08-22T18:30:00.000Z',
      winner: 'impostor',
      players: [{ friendCode, playerId: 1, team: 'impostor', role: 'impostor', won: true, kills: 2, tasksCompleted: 0, tasksTotal: 0, allTasksCompleted: false }]
    });
    const responses = await Promise.all([
      request(app).post(`/api/events/${event.slug}/matches`).set('Authorization', `Bearer ${token1}`).send(report('HOST_1-a', 'HOST_1', groupA.id, 'AAA#1')),
      request(app).post(`/api/events/${event.slug}/matches`).set('Authorization', `Bearer ${token2}`).send(report('HOST_2-b', 'HOST_2', groupB.id, 'BBB#2'))
    ]);
    assert.deepEqual(responses.map((response) => response.status), [201, 201]);

    const occupied = await request(app).post(`/api/events/${event.slug}/matches`)
      .set('Authorization', `Bearer ${token1}`)
      .send(report('HOST_1-a-again', 'HOST_1', groupA.id, 'AAA#1'))
      .expect(409);
    assert.equal(occupied.body.error.code, 'MATCH_SLOT_OCCUPIED');
  });

  it('lets the administrator move a host to the final without touching the other host', async () => {
    const assignment = await admin('put', `/api/admin/events/${event.id}/hosts/${host1.id}/assignment`)
      .send({ stageId: final.id, groupId: null })
      .expect(200);
    assert.equal(assignment.body.host.assignedStageId, final.id);
    assert.equal(assignment.body.host.assignedGroupId, null);
    assert.equal(assignment.body.context.reason, 'STAGE_NOT_ACTIVE');

    database.competition.updateStage(final.id, { ...final, status: 'active' });
    const ready = await context(token1, 'HOST_1').expect(200);
    assert.equal(ready.body.reportingEnabled, true);
    assert.equal(ready.body.group, null);
    assert.equal(ready.body.matchNumber, 1);
    assert.equal((await context(token2, 'HOST_2')).body.group.id, groupB.id);

    await admin('put', `/api/admin/events/${event.id}/hosts/${host2.id}/assignment`)
      .send({ stageId: final.id, groupId: null })
      .expect(409)
      .expect((response) => assert.equal(response.body.error.code, 'HOST_ASSIGNMENT_CONFLICT'));
  });

  it('publishes only a fingerprint of each registered Friend Code', async () => {
    const crypto = require('node:crypto');
    const linked = confirmedParticipant('con-codigo', 'ABC:1234', groupA.id);
    const unlinked = confirmedParticipant('sin-codigo', null, groupA.id);
    confirmedParticipant('otro-grupo', 'ZZZ#9', groupB.id);

    const body = (await context(token1, 'HOST_1').expect(200)).body;
    assert.equal(body.rosterSize, 2);
    assert.equal(body.rosterWithoutFriendCode, 1);
    assert.equal(JSON.stringify(body).includes('ABC:1234'), false);
    assert.equal(JSON.stringify(body).includes('abc#1234'), false);
    assert.equal(JSON.stringify(body).includes('ZZZ#9'), false);

    const expected = crypto.createHash('sha256').update('abc#1234', 'utf8').digest('hex');
    const linkedEntry = body.roster.find((member) => member.participantId === linked.id);
    assert.equal(linkedEntry.friendCodeFingerprint, expected);
    assert.equal(linkedEntry.displayName, 'con-codigo');
    assert.equal(body.roster.find((member) => member.participantId === unlinked.id).friendCodeFingerprint, null);

    const adminHosts = await admin('get', `/api/admin/events/${event.id}/hosts`).expect(200);
    assert.deepEqual(adminHosts.body.hosts[0].reporterContext.roster, []);
    assert.equal(adminHosts.body.hosts[0].reporterContext.rosterWithoutFriendCode, 1);
  });

  it('survives a restart and never stores the credential in clear text', async () => {
    const dbPath = database.path;
    database.close();
    database = openDatabase(dbPath);
    app = createApp({ database, logger: { info() {}, error() {} }, adminToken, reporterToken });
    const restored = await context(token1, 'HOST_1').expect(200);
    assert.equal(restored.body.group.id, groupA.id);
    const hosts = await admin('get', `/api/admin/events/${event.id}/hosts`).expect(200);
    assert.equal(JSON.stringify(hosts.body).includes(token1), false);
    assert.equal(JSON.stringify(hosts.body).includes(hashReporterToken(token1)), false);
    assert.equal(hosts.body.hosts[0].assignedGroupId, groupA.id);
  });
});
