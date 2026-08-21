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

describe('competition API', () => {
  let directory,database,app,event,stage,group,host,participant;
  const adminToken='admin-test',reporterToken='reporter-test';
  const admin=(method,url)=>request(app)[method](url).set('Authorization',`Bearer ${adminToken}`);
  beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'jartiland-competition-api-'));database=openDatabase(path.join(directory,'tournament.db'));app=createApp({database,logger:{info(){},error(){}},adminToken,reporterToken});event=database.getDefaultEvent();stage=database.competition.listStages(event.id)[0];database.competition.updateStage(stage.id,{status:'active'});stage=database.competition.getStage(stage.id);group=database.competition.listGroups(stage.id)[0];host=database.competition.listHosts(event.id)[0];participant=database.createParticipant(event.id,{discord_username:'privado',game_name:'Jugador'});database.updateParticipant(participant.id,{status:'confirmed',internalFriendCode:'SECRET#1'});database.competition.distributeGroups(stage.id);group=database.competition.listGroups(stage.id).find((item)=>database.competition.listStageParticipants(stage.id,item.id).length);});
  afterEach(()=>{database.close();fs.rmSync(directory,{recursive:true,force:true});});

  function structured(reportId='structured-1') { return {reportId,eventId:event.id,stageId:stage.id,groupId:group.id,hostId:host.identifier,matchNumber:1,playedAt:'2026-08-21T16:10:00+02:00',map:'The Skeld',winnerTeam:'crew',players:[{participantId:participant.id,role:'Crewmate',won:true,tasksCompleted:4,tasksTotal:4}]}; }

  it('publishes phases, schedule and prizes without private participant data', async()=>{
    const competition=await request(app).get(`/api/events/${event.slug}/competition`).expect(200);
    assert.equal(competition.body.stages.length,2);
    assert.equal(JSON.stringify(competition.body).includes('SECRET#1'),false);
    assert.equal(JSON.stringify(competition.body).includes('privado'),false);
    await request(app).get(`/api/events/${event.slug}/schedule`).expect(200).expect((response)=>assert.equal(response.body.schedule.length,5));
    await request(app).get(`/api/events/${event.slug}/prizes`).expect(200).expect((response)=>assert.equal(response.body.prizes.length,4));
  });

  it('validates Reporter scope, keeps reportId idempotent and never exposes the raw payload', async()=>{
    const first=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(structured()).expect(201);
    const replay=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(structured()).expect(200);
    assert.equal(replay.body.id,first.body.id);
    assert.equal(database.getMatch(first.body.id).submittedBy,host.identifier);
    assert.equal(database.countMatches(event.id),1);
    const publicList=await request(app).get(`/api/events/${event.slug}/matches`).expect(200);
    assert.equal(publicList.body.matches[0].report,undefined);
    assert.equal(publicList.body.matches[0].sourceIp,undefined);
    assert.equal(publicList.body.matches[0].hostId,undefined);
    assert.equal(publicList.body.matches[0].submittedBy,undefined);
    assert.equal(publicList.body.matches[0].stageName,undefined);
    assert.equal(publicList.body.matches[0].groupName,undefined);
    assert.equal(publicList.body.matches[0].hostIdentifier,undefined);
    assert.equal(publicList.body.matches[0].hostName,undefined);
    assert.equal(publicList.body.matches[0].stageId,stage.id);
    assert.equal(publicList.body.matches[0].groupId,group.id);
    const adminList=await admin('get',`/api/admin/events/${event.id}/matches`).expect(200);
    assert.equal(adminList.body.matches[0].stageName,stage.name);
    assert.equal(adminList.body.matches[0].groupName,group.name);
    assert.equal(adminList.body.matches[0].hostIdentifier,host.identifier);
    assert.equal(adminList.body.matches[0].hostName,host.name);
    const other=database.createEvent({name:'Otro',slug:'otro',game:'Otro',description:'',modules:{matches:true,competition:true}});
    const wrong={...structured('wrong-event'),eventId:other.id};
    const rejected=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(wrong);
    assert.equal(rejected.status,403);
    assert.equal(rejected.body.error.code,'REPORTER_HOST_MISMATCH');
  });

  it('isolates simultaneous hosts and groups while preserving idempotency and one VALID result per slot',async()=>{
    const secondParticipant=database.createParticipant(event.id,{discord_username:'paralelo',game_name:'Jugador paralelo'});
    database.updateParticipant(secondParticipant.id,{status:'confirmed'});
    database.competition.distributeGroups(stage.id);
    const groups=database.competition.listGroups(stage.id);
    const hosts=database.competition.listHosts(event.id);
    const token1=`jtr_${'D'.repeat(43)}`;
    const token2=`jtr_${'E'.repeat(43)}`;
    database.competition.setHostReporterToken(event.id,hosts[0].id,{tokenHash:hashReporterToken(token1)});
    database.competition.setHostReporterToken(event.id,hosts[1].id,{tokenHash:hashReporterToken(token2)});
    app=createApp({database,logger:{info(){},error(){}},adminToken,reporterToken});
    const reports=groups.map((currentGroup,index)=>{
      const member=database.competition.listStageParticipants(stage.id,currentGroup.id)[0];
      return {
        ...structured(index===0?'parallel-group-a':'parallel-group-b'),
        groupId:currentGroup.id,
        hostId:hosts[index].identifier,
        players:[{participantId:member.participantId,role:'Crewmate',won:true}]
      };
    });
    const first=await Promise.all(reports.map((report,index)=>request(app).post('/api/matches')
      .set('Authorization',`Bearer ${index===0?token1:token2}`).send(report)));
    assert.deepEqual(first.map((response)=>response.status).sort(),[201,201]);
    assert.equal(database.countMatches(event.id),2);
    assert.equal(database.competition.getStageLeaderboard(stage.id,groups[0].id).matchCount,1);
    assert.equal(database.competition.getStageLeaderboard(stage.id,groups[1].id).matchCount,1);

    const replay=await Promise.all(reports.map((report,index)=>request(app).post('/api/matches')
      .set('Authorization',`Bearer ${index===0?token1:token2}`).send(report)));
    assert.deepEqual(replay.map((response)=>response.status),[200,200]);
    assert.deepEqual(replay.map((response)=>response.body.id),first.map((response)=>response.body.id));
    assert.equal(database.countMatches(event.id),2);

    const collisions=['parallel-slot-first','parallel-slot-second'].map((reportId)=>({
      ...reports[0],reportId,matchNumber:2
    }));
    const collisionResponses=await Promise.all(collisions.map((report)=>request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`).send(report)));
    assert.deepEqual(collisionResponses.map((response)=>response.status).sort(),[201,409]);
    assert.equal(collisionResponses.find((response)=>response.status===409).body.error.code,'MATCH_SLOT_OCCUPIED');
    assert.equal(database.countMatches(event.id),3);
    assert.equal(database.competition.getStageLeaderboard(stage.id,groups[0].id).matchCount,2);
  });

  it('accepts only exact authenticated replays after a stage changes state',async()=>{
    const [host1,host2]=database.competition.listHosts(event.id);
    const token1=`jtr_${'F'.repeat(43)}`;
    const token2=`jtr_${'G'.repeat(43)}`;
    database.competition.setHostReporterToken(event.id,host1.id,{tokenHash:hashReporterToken(token1)});
    database.competition.setHostReporterToken(event.id,host2.id,{tokenHash:hashReporterToken(token2)});
    app=createApp({database,logger:{info(){},error(){}},adminToken,reporterToken});
    const original={...structured('immutable-replay'),hostId:host1.identifier};
    const created=await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`).send(original).expect(201);
    const equivalentInstant=await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`)
      .send({...original,playedAt:'2026-08-21T14:10:00.000Z'})
      .expect(200);
    assert.equal(equivalentInstant.body.id,created.body.id);
    const missingPlayedAt={...original};delete missingPlayedAt.playedAt;
    await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`)
      .send(missingPlayedAt)
      .expect(409)
      .expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));

    database.competition.updateStage(stage.id,{status:'pending'});
    const replay=await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`).send({...original}).expect(200);
    assert.equal(replay.body.id,created.body.id);
    database.competition.updateStage(stage.id,{status:'active'});
    database.competition.completeStage(stage.id,{force:true});
    const completedReplay=await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`).send({...original}).expect(200);
    assert.equal(completedReplay.body.id,created.body.id);
    database.updateParticipant(participant.id,{status:'disqualified'});
    const replayAfterParticipantChange=await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`).send({...original}).expect(200);
    assert.equal(replayAfterParticipantChange.body.id,created.body.id);
    const host1LastSeen=database.competition.getHost(event.id,host1.id).lastSeenAt;

    await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`)
      .send({...original,map:'Polus'})
      .expect(409)
      .expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));
    assert.equal(database.competition.getHost(event.id,host1.id).lastSeenAt,host1LastSeen);

    await request(app).post('/api/matches').set('Authorization',`Bearer ${token2}`)
      .send({...original,hostId:host2.identifier})
      .expect(409)
      .expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));
    assert.equal(database.competition.getHost(event.id,host2.id).lastSeenAt,null);

    const otherStage=database.competition.listStages(event.id)[1];
    await request(app).post('/api/matches').set('Authorization',`Bearer ${token1}`)
      .send({...original,stageId:otherStage.id,groupId:null})
      .expect(409)
      .expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));
    assert.equal(database.countMatches(event.id),1);
  });

  it('replays a request fingerprint without resolving a changed Friend Code again',async()=>{
    const report={
      ...structured('friend-code-replay'),
      players:[{friendCode:'SECRET#1',role:'Crewmate',won:true,tasksCompleted:4,tasksTotal:4}]
    };
    const created=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(report).expect(201);
    database.updateParticipant(participant.id,{internalFriendCode:'SECRET#NEW'});

    const replay=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send({...report}).expect(200);
    assert.equal(replay.body.id,created.body.id);
    await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`)
      .send({...report,map:'Polus'})
      .expect(409)
      .expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));
    assert.equal(JSON.stringify(database.getMatch(created.body.id)).includes('SECRET#1'),false);
    const adminHistory=await admin('get',`/api/admin/events/${event.id}/matches`).expect(200);
    assert.equal(JSON.stringify(adminHistory.body).includes('reportFingerprint'),false);
    assert.equal(JSON.stringify(adminHistory.body).includes('report_fingerprint'),false);
  });

  it('does not attach audit names from competitive ids belonging to another event',async()=>{
    const other=database.createEvent({name:'Evento ajeno',slug:'evento-ajeno',game:'Otro',description:'',modules:{matches:true,competition:true}});
    const foreignStage=database.competition.createStage(other.id,{name:'Fase ajena',type:'group_stage',position:1,matchesPerGroup:1});
    const foreignGroup=database.competition.replaceGroups(foreignStage.id,[{name:'Grupo ajeno',position:1}])[0];
    const foreignHost=database.competition.replaceHosts(other.id,[{name:'Host ajeno',identifier:'FOREIGN_HOST',enabled:true}])[0];
    database.insertMatch({reportId:'cross-event-audit',players:[]},null,event.id,{
      stageId:foreignStage.id,
      groupId:foreignGroup.id,
      hostId:foreignHost.id,
      matchNumber:1,
      origin:'SIMULATOR'
    });

    const adminList=await admin('get',`/api/admin/events/${event.id}/matches`).expect(200);
    const crossed=adminList.body.matches.find((match)=>match.report.reportId==='cross-event-audit');
    assert.ok(crossed);
    assert.equal(crossed.stageName,null);
    assert.equal(crossed.groupName,null);
    assert.equal(crossed.hostIdentifier,null);
    assert.equal(crossed.hostName,null);
    const publicList=await request(app).get(`/api/events/${event.slug}/matches`).expect(200);
    assert.equal(JSON.stringify(publicList.body).includes('Fase ajena'),false);
    assert.equal(JSON.stringify(publicList.body).includes('Grupo ajeno'),false);
    assert.equal(JSON.stringify(publicList.body).includes('Host ajeno'),false);
    assert.equal(JSON.stringify(publicList.body).includes('FOREIGN_HOST'),false);
  });

  it('authenticates each Reporter host independently and updates only successful activity', async()=>{
    const hosts=database.competition.listHosts(event.id);
    const [host1,host2]=hosts;
    const token1=`jtr_${'A'.repeat(43)}`;
    const token2=`jtr_${'B'.repeat(43)}`;
    database.competition.setHostReporterToken(event.id,host1.id,{tokenHash:hashReporterToken(token1)});
    database.competition.setHostReporterToken(event.id,host2.id,{tokenHash:hashReporterToken(token2)});
    app=createApp({database,logger:{info(){},error(){}},adminToken,reporterToken});

    const accepted=await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`)
      .send({...structured('host1-a-1'),hostId:host1.identifier})
      .expect(201);
    assert.equal(accepted.body.result.reportId,'host1-a-1');
    const stored=database.getMatch(accepted.body.id);
    assert.equal(stored.hostId,host1.id);
    assert.equal(stored.submittedBy,host1.identifier);
    assert.ok(database.competition.getHost(event.id,host1.id).lastSeenAt);
    assert.equal(database.competition.getHost(event.id,host2.id).lastSeenAt,null);

    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`)
      .send({...structured('spoofed-host'),hostId:host2.identifier,matchNumber:2})
      .expect(403)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_HOST_MISMATCH'));
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${reporterToken}`)
      .send({...structured('unknown-host'),hostId:'HOST_UNKNOWN',matchNumber:2})
      .expect(403)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_HOST_MISMATCH'));
    await request(app).post('/api/matches')
      .set('Authorization','Bearer jtr_invalid')
      .send({...structured('invalid-token'),matchNumber:2})
      .expect(401)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_TOKEN_INVALID'));
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`)
      .send({...structured('missing-host'),hostId:undefined,matchNumber:2})
      .expect(400)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_HOST_REQUIRED'));
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`)
      .send({reportId:'historical-missing-host',players:[]})
      .expect(400)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_HOST_REQUIRED'));

    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token2}`)
      .send({...structured('failed-ingest'),hostId:host2.identifier,matchNumber:stage.matchesPerGroup+1})
      .expect(400)
      .expect((response)=>assert.equal(response.body.error.code,'MATCH_NUMBER_OUT_OF_RANGE'));
    assert.equal(database.competition.getHost(event.id,host2.id).lastSeenAt,null);

    const other=database.createEvent({name:'Token ajeno',slug:'token-ajeno',game:'Otro',description:'',modules:{matches:true}});
    await request(app).post(`/api/events/${other.slug}/matches`)
      .set('Authorization',`Bearer ${token2}`)
      .send({reportId:'wrong-token-event',hostId:host2.identifier,players:[]})
      .expect(401)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_TOKEN_INVALID'));

    database.competition.revokeHostReporterToken(event.id,host1.id);
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token1}`)
      .send({...structured('revoked-token'),matchNumber:2})
      .expect(401)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_TOKEN_INVALID'));

    database.competition.replaceHosts(event.id,hosts.map((item)=>({
      ...item,
      enabled:item.id===host2.id?false:item.enabled
    })));
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${token2}`)
      .send({...structured('disabled-host'),hostId:host2.identifier,matchNumber:2})
      .expect(403)
      .expect((response)=>assert.equal(response.body.error.code,'REPORTER_HOST_DISABLED'));
  });

  it('creates one-time Reporter configuration and revokes it without exposing hashes',async()=>{
    const withoutUrl=await admin('post',`/api/admin/events/${event.id}/hosts/${host.identifier}/token`).expect(503);
    assert.equal(withoutUrl.body.error.code,'REPORTER_PRIVATE_URL_NOT_CONFIGURED');
    assert.equal(database.competition.getHost(event.id,host.id).tokenConfigured,false);
    const previousToken=`jtr_${'C'.repeat(43)}`;
    database.competition.setHostReporterToken(event.id,host.id,{tokenHash:hashReporterToken(previousToken)});
    await admin('post',`/api/admin/events/${event.id}/hosts/${host.identifier}/token`).expect(503);
    assert.equal(database.competition.findHostByReporterTokenHash(event.id,hashReporterToken(previousToken)).id,host.id);

    app=createApp({
      database,
      logger:{info(){},error(){}},
      adminToken,
      reporterToken,
      reporterPrivateUrl:'https://mini-eventos-jartiland.example.ts.net'
    });
    const generated=await admin('post',`/api/admin/events/${event.id}/hosts/${host.identifier}/token`).expect(201);
    assert.equal(generated.headers['cache-control'],'no-store');
    assert.match(generated.body.token,/^jtr_[A-Za-z0-9_-]{43}$/);
    assert.equal(generated.body.reporterConfig,
      `ServerUrl=https://mini-eventos-jartiland.example.ts.net\nHostId=${host.identifier}\nReporterToken=${generated.body.token}\n`);
    assert.equal(generated.body.host.tokenConfigured,true);
    assert.equal(JSON.stringify(generated.body).includes('reporter_token_hash'),false);
    assert.equal(JSON.stringify(generated.body.host).includes(generated.body.token),false);

    const listed=await admin('get',`/api/admin/events/${event.id}/hosts`).expect(200);
    assert.equal(JSON.stringify(listed.body).includes(generated.body.token),false);
    assert.equal(JSON.stringify(listed.body).includes('reporter_token_hash'),false);
    assert.equal(listed.body.hosts.find((item)=>item.id===host.id).tokenConfigured,true);

    const revoked=await admin('delete',`/api/admin/events/${event.id}/hosts/${host.id}/token`).expect(200);
    assert.equal(revoked.body.host.tokenConfigured,false);
    await request(app).post('/api/matches')
      .set('Authorization',`Bearer ${generated.body.token}`)
      .send(structured('revoked-admin-token'))
      .expect(401);
  });

  it('uses the same ingestion for simulator, exposes scoring breakdown privately and supports VOID', async()=>{
    const simulated=await admin('post',`/api/admin/events/${event.id}/simulator`).send({report:structured('simulated-1')}).expect(201);
    assert.equal(simulated.body.match.origin,'SIMULATOR');
    let leaderboard=await admin('get',`/api/admin/stages/${stage.id}/leaderboard?groupId=${group.id}`).expect(200);
    assert.equal(leaderboard.body.standings[0].points,5);
    assert.equal(leaderboard.body.standings[0].breakdowns[0].score.tasks,1);
    await admin('patch',`/api/admin/events/${event.id}/matches/${simulated.body.match.id}/void`).send({reason:'Desconexión general'}).expect(200);
    leaderboard=await admin('get',`/api/admin/stages/${stage.id}/leaderboard?groupId=${group.id}`).expect(200);
    assert.equal(leaderboard.body.matchCount,0);
    const history=await admin('get',`/api/admin/events/${event.id}/matches`).expect(200);
    assert.equal(history.body.matches[0].matchStatus,'VOID');
    assert.equal(history.body.matches[0].voidReason,'Desconexión general');
  });

  it('rejects inactive phases, invalid or occupied slots and duplicate players',async()=>{
    const pending=database.competition.listStages(event.id)[1];
    await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send({...structured('pending-stage'),stageId:pending.id,groupId:null}).expect(409).expect((response)=>assert.equal(response.body.error.code,'STAGE_NOT_ACTIVE'));
    await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send({...structured('too-many'),matchNumber:stage.matchesPerGroup+1}).expect(400).expect((response)=>assert.equal(response.body.error.code,'MATCH_NUMBER_OUT_OF_RANGE'));
    const duplicated={...structured('duplicate-player'),matchNumber:2};duplicated.players=[duplicated.players[0],{...duplicated.players[0]}];await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(duplicated).expect(400).expect((response)=>assert.equal(response.body.error.code,'DUPLICATE_REPORT_PLAYER'));
    await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send({...structured('slot-first'),matchNumber:3}).expect(201);
    await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send({...structured('slot-second'),matchNumber:3}).expect(409).expect((response)=>assert.equal(response.body.error.code,'MATCH_SLOT_OCCUPIED'));
  });

  it('cannot bypass the audited completion workflow through the generic stage editor',async()=>{
    await admin('put',`/api/admin/stages/${stage.id}`).send({status:'completed'}).expect(409).expect((response)=>assert.equal(response.body.error.code,'USE_STAGE_COMPLETION'));
    assert.equal(database.competition.getStage(stage.id).status,'active');
    const pending=database.competition.listStages(event.id)[1];await admin('post',`/api/admin/stages/${pending.id}/complete`).send({force:true}).expect(409).expect((response)=>assert.equal(response.body.error.code,'STAGE_NOT_ACTIVE'));
    await admin('post',`/api/admin/stages/${stage.id}/complete`).send({force:true}).expect(200);
    await admin('put',`/api/admin/stages/${stage.id}`).send({status:'active'}).expect(409).expect((response)=>assert.equal(response.body.error.code,'STAGE_ALREADY_COMPLETED'));
  });

  it('requires a group for group-stage leaderboards and respects the competition module',async()=>{
    await request(app).get(`/api/events/${event.slug}/stages/${stage.id}/leaderboard`).expect(400).expect((response)=>assert.equal(response.body.error.code,'GROUP_REQUIRED'));
    database.updateEvent(event.id,{modules:{...event.modules,competition:false}});
    await request(app).get(`/api/events/${event.slug}/stages/${stage.id}/leaderboard?groupId=${group.id}`).expect(404).expect((response)=>assert.equal(response.body.error.code,'MODULE_DISABLED'));
  });

  it('records legacy admin results as MANUAL with an admin actor',async()=>{
    const created=await admin('post',`/api/admin/events/${event.id}/matches`).send({report:{reportId:'manual-legacy',players:[]}}).expect(201);
    assert.equal(created.body.origin,'MANUAL');
    assert.equal(created.body.submittedBy,'ADMIN');
    await admin('post',`/api/admin/events/${event.id}/matches`)
      .send({report:{reportId:'manual-partial-context',players:[]},context:{groupId:group.id,matchNumber:5}})
      .expect(400)
      .expect((response)=>assert.equal(response.body.error.code,'STAGE_REQUIRED'));
    const scoped=structured('manual-context');const context={stageId:scoped.stageId,groupId:scoped.groupId,hostId:scoped.hostId,matchNumber:4,playedAt:scoped.playedAt};delete scoped.eventId;delete scoped.stageId;delete scoped.groupId;delete scoped.hostId;delete scoped.matchNumber;delete scoped.playedAt;const competitive=await admin('post',`/api/admin/events/${event.id}/matches`).send({report:scoped,context}).expect(201);assert.equal(competitive.body.origin,'MANUAL');assert.equal(competitive.body.stageId,stage.id);assert.equal(competitive.body.groupId,group.id);assert.equal(competitive.body.matchNumber,4);
    const equivalentContext={...context,playedAt:'2026-08-21T14:10:00.000Z'};const manualReplay=await admin('post',`/api/admin/events/${event.id}/matches`).send({report:scoped,context:equivalentContext}).expect(200);assert.equal(manualReplay.body.id,competitive.body.id);
    const contextWithoutPlayedAt={...context};delete contextWithoutPlayedAt.playedAt;await admin('post',`/api/admin/events/${event.id}/matches`).send({report:scoped,context:contextWithoutPlayedAt}).expect(409).expect((response)=>assert.equal(response.body.error.code,'REPORT_ID_CONFLICT'));
  });
});
