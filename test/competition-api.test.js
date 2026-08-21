'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');

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
    assert.equal(database.countMatches(event.id),1);
    const publicList=await request(app).get(`/api/events/${event.slug}/matches`).expect(200);
    assert.equal(publicList.body.matches[0].report,undefined);
    assert.equal(publicList.body.matches[0].sourceIp,undefined);
    assert.equal(publicList.body.matches[0].hostId,undefined);
    assert.equal(publicList.body.matches[0].submittedBy,undefined);
    assert.equal(publicList.body.matches[0].stageId,stage.id);
    assert.equal(publicList.body.matches[0].groupId,group.id);
    const other=database.createEvent({name:'Otro',slug:'otro',game:'Otro',description:'',modules:{matches:true,competition:true}});
    const wrong={...structured('wrong-event'),eventId:other.id};
    const rejected=await request(app).post('/api/matches').set('Authorization',`Bearer ${reporterToken}`).send(wrong);
    assert.equal(rejected.status,400);
    assert.equal(rejected.body.error.code,'STAGE_EVENT_MISMATCH');
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
    const scoped=structured('manual-context');const context={stageId:scoped.stageId,groupId:scoped.groupId,hostId:scoped.hostId,matchNumber:4,playedAt:scoped.playedAt};delete scoped.eventId;delete scoped.stageId;delete scoped.groupId;delete scoped.hostId;delete scoped.matchNumber;delete scoped.playedAt;const competitive=await admin('post',`/api/admin/events/${event.id}/matches`).send({report:scoped,context}).expect(201);assert.equal(competitive.body.origin,'MANUAL');assert.equal(competitive.body.stageId,stage.id);assert.equal(competitive.body.groupId,group.id);assert.equal(competitive.body.matchNumber,4);
  });
});
