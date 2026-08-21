'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/database');
const { createMatchIngestor } = require('../src/services/match-ingest');

describe('complete tournament flow',()=>{
  let directory;
  afterEach(()=>directory&&fs.rmSync(directory,{recursive:true,force:true}));
  it('runs 20 players through 10/10 groups, top five, reset final and champion',()=>{
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'jartiland-full-flow-'));const database=openDatabase(path.join(directory,'tournament.db'));const ingest=createMatchIngestor({database});const event=database.getDefaultEvent();let [classification,final]=database.competition.listStages(event.id);database.competition.updateStage(classification.id,{status:'active'});classification=database.competition.getStage(classification.id);const groups=database.competition.listGroups(classification.id);const hosts=database.competition.listHosts(event.id);
    for(let index=1;index<=20;index++){const participant=database.createParticipant(event.id,{discord_username:`qa${index}`,game_name:`Jugador ${String(index).padStart(2,'0')}`});database.updateParticipant(participant.id,{status:'confirmed',internalFriendCode:`QA#${index}`});}
    const assignments=database.competition.distributeGroups(classification.id);assert.deepEqual(groups.map((group)=>assignments.filter((row)=>row.groupId===group.id).length),[10,10]);
    groups.forEach((group,groupIndex)=>{const members=database.competition.listStageParticipants(classification.id,group.id);for(let matchNumber=1;matchNumber<=5;matchNumber++)ingest.ingest({eventId:event.id,origin:'SIMULATOR',submittedBy:'QA',report:{reportId:`qa-g${groupIndex+1}-m${matchNumber}`,players:members.map((member,index)=>({participantId:member.participantId,role:'Crewmate',won:index<5}))},context:{stageId:classification.id,groupId:group.id,hostId:hosts[groupIndex].id,matchNumber}});});
    const groupBoards=groups.map((group)=>database.competition.getStageLeaderboard(classification.id,group.id));assert.equal(groupBoards[0].matchCount,5);assert.equal(groupBoards[1].matchCount,5);assert.notDeepEqual(groupBoards[0].standings.map((row)=>row.participantId),groupBoards[1].standings.map((row)=>row.participantId));
    database.competition.completeStage(classification.id);const finalists=database.competition.listStageParticipants(final.id);assert.equal(finalists.length,10);assert.equal(database.competition.getStageLeaderboard(final.id).standings.every((row)=>row.points===0),true);
    database.competition.updateStage(final.id,{resetPoints:false});const carriedBoard=database.competition.getStageLeaderboard(final.id);assert.equal(carriedBoard.matchCount,10);assert.equal(carriedBoard.standings.every((row)=>row.points>0),true);database.competition.updateStage(final.id,{resetPoints:true});assert.equal(database.competition.getStageLeaderboard(final.id).matchCount,0);
    for(let matchNumber=1;matchNumber<=5;matchNumber++)ingest.ingest({eventId:event.id,origin:'SIMULATOR',submittedBy:'QA',report:{reportId:`qa-final-m${matchNumber}`,players:finalists.map((member,index)=>({participantId:member.participantId,role:index===0?'Impostor':'Crewmate',won:index===0}))},context:{stageId:final.id,groupId:null,hostId:hosts[0].id,matchNumber}});
    const finalBoard=database.competition.getStageLeaderboard(final.id);assert.equal(finalBoard.matchCount,5);assert.equal(finalBoard.standings[0].points,25);database.competition.completeStage(final.id);const champion=database.competition.listStageParticipants(final.id).find((member)=>member.competitiveStatus==='champion');assert.equal(champion.participantId,finalBoard.standings[0].participantId);database.close();
  });
});
