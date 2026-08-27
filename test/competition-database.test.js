'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const { openDatabase } = require('../src/database');
const { createMatchIngestor } = require('../src/services/match-ingest');

describe('competition database', () => {
  const directories = [];
  const temporaryPath = () => { const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jartiland-competition-'));directories.push(directory);return path.join(directory,'tournament.db'); };
  afterEach(()=>directories.splice(0).forEach((directory)=>fs.rmSync(directory,{recursive:true,force:true})));

  function participant(database, eventId, name, status = 'confirmed') {
    const created=database.createParticipant(eventId,{discord_username:`${name}@qa`,game_name:name,friend_code:`${name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'')}#1001`});
    return database.updateParticipant(created.id,{status});
  }

  it('migrates twice, preserves historical rows and seeds editable Among Us competition data once', () => {
    const dbPath=temporaryPath(); let database=openDatabase(dbPath); const event=database.getDefaultEvent();
    const inserted=database.insertMatch({reportId:'legacy-preserved',players:[]},null,event.id); const stageIds=database.competition.listStages(event.id).map((stage)=>stage.id); database.close();
    let raw=new BetterSqlite3(dbPath,{readonly:true});const fingerprintBefore=raw.prepare('SELECT report_fingerprint fingerprint FROM matches WHERE id=?').get(inserted.id).fingerprint;assert.match(fingerprintBefore,/^[a-f0-9]{64}$/);raw.close();
    database=openDatabase(dbPath);
    assert.equal(database.countMatches(event.id),1);
    assert.equal(Object.hasOwn(database.getMatch(inserted.id),'reportFingerprint'),false);
    assert.deepEqual(database.competition.listStages(event.id).map((stage)=>stage.id),stageIds);
    assert.deepEqual(database.competition.listStages(event.id).map((stage)=>[stage.name,stage.matchesPerGroup,stage.qualifiersPerGroup,stage.resetPoints]),[
      ['Fase de Clasificación',5,5,true],['Gran Final',5,0,true]
    ]);
    assert.deepEqual(database.competition.listGroups(stageIds[0]).map((group)=>group.name),['Grupo A','Grupo B']);
    assert.deepEqual(database.competition.listHosts(event.id).map((host)=>host.identifier),['HOST_1','HOST_2']);
    assert.equal(database.competition.listSchedule(event.id).length,5);
    assert.equal(database.competition.listPrizes(event.id).length,4);
    database.close();
    raw=new BetterSqlite3(dbPath,{readonly:true}); assert.equal(raw.prepare('SELECT report_fingerprint fingerprint FROM matches WHERE id=?').get(inserted.id).fingerprint,fingerprintBefore);assert.equal(raw.pragma('integrity_check',{simple:true}),'ok'); raw.close();
  });

  it('migrates a legacy event_hosts table without losing host ids or historical data', () => {
    const dbPath = temporaryPath();
    let database = openDatabase(dbPath);
    const event = database.getDefaultEvent();
    const hosts = database.competition.replaceHosts(event.id, database.competition.listHosts(event.id).map((host, index) => ({
      id: host.id,
      identifier: host.identifier,
      name: `Host legado ${index + 1}`,
      enabled: index === 0
    })));
    const match = database.insertMatch(
      { reportId: 'legacy-event-hosts-result', players: [] },
      null,
      event.id,
      { hostId: hosts[0].id }
    );
    database.close();

    let raw = new BetterSqlite3(dbPath);
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      DROP INDEX IF EXISTS idx_event_hosts_reporter_token_hash;
      CREATE TABLE event_hosts_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        identifier TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        UNIQUE(event_id, identifier),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      INSERT INTO event_hosts_legacy(id,event_id,name,identifier,enabled)
      SELECT id,event_id,name,identifier,enabled FROM event_hosts;
      DROP TABLE event_hosts;
      ALTER TABLE event_hosts_legacy RENAME TO event_hosts;
    `);
    assert.deepEqual(raw.pragma('table_info(event_hosts)').map((column) => column.name), [
      'id', 'event_id', 'name', 'identifier', 'enabled'
    ]);
    raw.close();

    database = openDatabase(dbPath);
    assert.throws(
      () => database.competition.setHostReporterToken(event.id, hosts[0].id, { tokenHash: 'token-en-claro' }),
      (error) => error.code === 'REPORTER_TOKEN_HASH_INVALID'
    );
    assert.deepEqual(
      database.competition.listHosts(event.id).map(({ id, name, identifier, enabled }) => ({ id, name, identifier, enabled })),
      hosts.map(({ id, name, identifier, enabled }) => ({ id, name, identifier, enabled }))
    );
    assert.equal(database.getMatch(match.id).hostId, hosts[0].id);
    database.close();

    raw = new BetterSqlite3(dbPath);
    const migratedColumns = raw.pragma('table_info(event_hosts)').map((column) => column.name);
    assert.equal(migratedColumns.includes('reporter_token_hash'), true);
    assert.throws(
      () => raw.prepare('UPDATE event_hosts SET reporter_token_hash=? WHERE id=?').run('token-en-claro', hosts[0].id),
      (error) => error.code === 'SQLITE_CONSTRAINT_CHECK'
    );
    assert.equal(raw.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(raw.pragma('foreign_key_check'), []);
    raw.close();
  });

  it('stores only hashed per-host credentials and preserves them across migrations', () => {
    const dbPath = temporaryPath();
    let database = openDatabase(dbPath);
    const event = database.getDefaultEvent();
    const host = database.competition.listHosts(event.id)[0];
    for (const tokenHash of [null, '', 'token-en-claro', 'A'.repeat(64), 'g'.repeat(64), { toString: () => 'a'.repeat(64) }]) {
      assert.throws(
        () => database.competition.setHostReporterToken(event.id, host.id, { tokenHash }),
        (error) => error.code === 'REPORTER_TOKEN_HASH_INVALID'
      );
    }
    assert.equal(database.competition.getHost(event.id, host.id).tokenConfigured, false);
    database.competition.setHostReporterToken(event.id, host.id, {
      tokenHash: 'a'.repeat(64),
      createdAt: '2026-08-21T18:00:00.000Z'
    });
    assert.equal(database.competition.listHosts(event.id)[0].tokenConfigured, true);
    database.close();

    const raw = new BetterSqlite3(dbPath);
    assert.throws(
      () => raw.prepare('UPDATE event_hosts SET reporter_token_hash=? WHERE id=?').run('A'.repeat(64), host.id),
      (error) => error.code === 'SQLITE_CONSTRAINT_CHECK'
    );
    raw.close();

    database = openDatabase(dbPath);
    const reopened = database.competition.getHost(event.id, host.identifier);
    assert.equal(reopened.id, host.id);
    assert.equal(reopened.tokenConfigured, true);
    assert.equal(JSON.stringify(reopened).includes('a'.repeat(64)), false);
    database.competition.revokeHostReporterToken(event.id, host.id);
    assert.equal(database.competition.getHost(event.id, host.id).tokenConfigured, false);
    database.close();
  });

  it('distributes only confirmed participants evenly and supports manual moves until locked', () => {
    const database=openDatabase(temporaryPath()); const event=database.getDefaultEvent(); const stage=database.competition.listStages(event.id)[0]; const groups=database.competition.listGroups(stage.id);
    const confirmed=Array.from({length:5},(_,index)=>participant(database,event.id,`Jugador ${index+1}`));
    participant(database,event.id,'Pendiente','pending'); participant(database,event.id,'Rechazado','rejected'); participant(database,event.id,'Ausente','absent'); participant(database,event.id,'DQ','disqualified');
    let assignments=database.competition.distributeGroups(stage.id);
    assert.equal(assignments.length,5);
    assert.deepEqual(groups.map((group)=>assignments.filter((row)=>row.groupId===group.id).length),[3,2]);
    database.competition.assignParticipant(stage.id,confirmed[0].id,groups[1].id);
    assert.equal(database.competition.listStageParticipants(stage.id).find((row)=>row.participantId===confirmed[0].id).groupId,groups[1].id);
    database.competition.setGroupsLocked(stage.id,true);
    assert.throws(()=>database.competition.assignParticipant(stage.id,confirmed[0].id,groups[0].id),(error)=>error.code==='GROUPS_LOCKED');
    assert.throws(()=>database.competition.distributeGroups(stage.id),(error)=>error.code==='GROUPS_LOCKED');
    database.competition.setGroupsLocked(stage.id,false);
    database.competition.assignParticipant(stage.id,confirmed[0].id,null);
    assert.equal(database.competition.listStageParticipants(stage.id).find((row)=>row.participantId===confirmed[0].id).groupId,null);
    database.close();
  });

  it('lists confirmed players with no group so a late signup can be placed by hand', () => {
    const database=openDatabase(temporaryPath()); const event=database.getDefaultEvent();
    const stage=database.competition.listStages(event.id)[0]; const groups=database.competition.listGroups(stage.id);
    Array.from({length:4},(_,index)=>participant(database,event.id,`Jugador ${index+1}`));
    database.competition.distributeGroups(stage.id);

    // Se apunta cuando el reparto ya está hecho: no tiene fila en la fase.
    const tarde=participant(database,event.id,'Asesino');
    participant(database,event.id,'SinConfirmar','pending');

    const sueltos=()=>database.competition.listStages(event.id).find((item)=>item.id===stage.id).unassigned;
    assert.deepEqual(sueltos().map((row)=>row.displayName),['Asesino']);
    assert.equal(sueltos()[0].inStage,false);

    // Meterlo a mano en el segundo grupo lo saca de la lista.
    database.competition.assignParticipant(stage.id,tarde.id,groups[1].id);
    assert.deepEqual(sueltos(),[]);
    assert.equal(database.competition.listStageParticipants(stage.id,groups[1].id)
      .some((row)=>row.participantId===tarde.id),true);

    // Y quien se queda sin grupo vuelve a aparecer, con su fila ya creada.
    database.competition.assignParticipant(stage.id,tarde.id,null);
    assert.deepEqual(sueltos().map((row)=>row.displayName),['Asesino']);
    assert.equal(sueltos()[0].inStage,true);

    // Una fase que no es de grupos no tiene bandeja de sueltos que enseñar.
    const final=database.competition.createStage(event.id,{name:'Gran final',type:'final',position:9,matchesPerGroup:5});
    assert.deepEqual(database.competition.listStages(event.id).find((item)=>item.id===final.id).unassigned,[]);
    database.close();
  });

  it('edits groups and hosts without changing ids or orphaning historical matches', () => {
    const dbPath=temporaryPath();const database=openDatabase(dbPath);const event=database.getDefaultEvent();const stage=database.competition.listStages(event.id)[0];const groups=database.competition.listGroups(stage.id);const hosts=database.competition.listHosts(event.id);const player=participant(database,event.id,'Histórico');database.competition.distributeGroups(stage.id);const assigned=database.competition.listStageParticipants(stage.id).find((row)=>row.participantId===player.id);const group=groups.find((row)=>row.id===assigned.groupId);
    const tokenHash='c'.repeat(64);const tokenCreatedAt='2026-08-21T19:00:00.000Z';database.competition.setHostReporterToken(event.id,hosts[0].id,{tokenHash,createdAt:tokenCreatedAt});const credentialBefore=database.competition.touchHostReporterToken(event.id,hosts[0].id);
    database.insertMatch({reportId:'historical-scope',players:[{participantId:player.id,name:player.displayName,role:'Crewmate',won:true}]},null,event.id,{stageId:stage.id,groupId:group.id,hostId:hosts[0].id,matchNumber:1});
    database.competition.replaceGroups(stage.id,groups.map((row)=>({id:row.id,name:`${row.name} editado`,position:row.position})));
    assert.throws(()=>database.competition.replaceHosts(event.id,hosts.map((row)=>({id:row.id,identifier:row.id===hosts[0].id?'HOST_RENAMED':row.identifier,name:row.name,enabled:true}))),(error)=>error.code==='HOST_IDENTIFIER_LOCKED'&&error.status===409);
    database.competition.replaceHosts(event.id,hosts.map((row)=>({id:row.id,identifier:row.identifier,name:`${row.name} editado`,enabled:true})));
    assert.deepEqual(database.competition.listGroups(stage.id).map((row)=>row.id),groups.map((row)=>row.id));
    assert.deepEqual(database.competition.listHosts(event.id).map((row)=>row.id),hosts.map((row)=>row.id));
    const credentialAfter=database.competition.getHost(event.id,hosts[0].id);assert.equal(credentialAfter.tokenConfigured,true);assert.equal(credentialAfter.tokenCreatedAt,tokenCreatedAt);assert.equal(credentialAfter.lastSeenAt,credentialBefore.lastSeenAt);assert.equal(JSON.stringify(credentialAfter).includes(tokenHash),false);
    assert.equal(database.competition.listStageParticipants(stage.id,group.id).length,1);
    assert.equal(database.competition.getStageLeaderboard(stage.id,group.id).matchCount,1);
    assert.throws(()=>database.competition.replaceGroups(stage.id,groups.filter((row)=>row.id!==group.id)),(error)=>error.code==='GROUP_IN_USE');
    assert.throws(()=>database.competition.replaceHosts(event.id,hosts.filter((row)=>row.id!==hosts[0].id)),(error)=>error.code==='HOST_IN_USE');
    database.close();
    const raw=new BetterSqlite3(dbPath,{readonly:true});const storedCredential=raw.prepare('SELECT reporter_token_hash tokenHash,reporter_token_created_at tokenCreatedAt,reporter_last_seen_at lastSeenAt FROM event_hosts WHERE id=?').get(hosts[0].id);assert.deepEqual(storedCredential,{tokenHash,tokenCreatedAt,lastSeenAt:credentialBefore.lastSeenAt});raw.close();
  });

  it('keeps registration and competitive disqualification separate and excludes the player',()=>{
    const database=openDatabase(temporaryPath());const ingest=createMatchIngestor({database});const event=database.getDefaultEvent();let stage=database.competition.listStages(event.id)[0];database.competition.updateStage(stage.id,{status:'active'});stage=database.competition.getStage(stage.id);const player=participant(database,event.id,'Expulsado');database.competition.distributeGroups(stage.id);const member=database.competition.listStageParticipants(stage.id).find((row)=>row.participantId===player.id);ingest.ingest({eventId:event.id,report:{reportId:'before-dq',players:[{participantId:player.id,role:'Crewmate',won:true}]},context:{stageId:stage.id,groupId:member.groupId,matchNumber:1}});assert.equal(database.competition.getStageLeaderboard(stage.id,member.groupId).standings[0].points,4);
    database.updateParticipant(player.id,{status:'disqualified'});const disqualified=database.competition.listStageParticipants(stage.id).find((row)=>row.participantId===player.id);assert.equal(disqualified.registrationStatus,'disqualified');assert.equal(disqualified.competitiveStatus,'disqualified');assert.equal(database.competition.getStageLeaderboard(stage.id,member.groupId).standings.length,0);assert.throws(()=>ingest.ingest({eventId:event.id,report:{reportId:'after-dq',players:[{participantId:player.id,role:'Crewmate',won:true}]},context:{stageId:stage.id,groupId:member.groupId,matchNumber:2}}),(error)=>error.code==='PLAYER_DISQUALIFIED');database.close();
  });

  it('validates tie scope, audit reason and contradictory cycles',()=>{
    const database=openDatabase(temporaryPath());const event=database.getDefaultEvent();const stage=database.competition.listStages(event.id)[0];const group=database.competition.listGroups(stage.id)[0];const players=['Uno','Dos','Tres'].map((name)=>participant(database,event.id,name));database.competition.distributeGroups(stage.id);players.forEach((player)=>database.competition.assignParticipant(stage.id,player.id,group.id));
    assert.throws(()=>database.competition.resolveTie(stage.id,{groupId:group.id,higherParticipantId:players[0].id,lowerParticipantId:players[1].id,reason:''}),(error)=>error.code==='TIE_REASON_REQUIRED');database.competition.resolveTie(stage.id,{groupId:group.id,higherParticipantId:players[0].id,lowerParticipantId:players[1].id,reason:'Primera decisión'});assert.throws(()=>database.competition.resolveTie(stage.id,{groupId:group.id,higherParticipantId:players[1].id,lowerParticipantId:players[0].id,reason:'Contradicción'}),(error)=>error.code==='TIE_RESOLUTION_CYCLE');assert.equal(database.competition.listTieResolutions(stage.id).length,1);database.close();
  });
});
