'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { automaticCompare, balanceParticipants, buildCompetitionLeaderboard } = require('../src/competition');

function match(players, id = 1) {
  return { id, receivedAt: `2026-08-21T16:${String(id).padStart(2, '0')}:00Z`, status: 'VALID', report: { players } };
}

describe('competition domain', () => {
  it('balances confirmed participant ids with a maximum difference of one', () => {
    const twenty = balanceParticipants(Array.from({ length: 20 }, (_, index) => index + 1), [10, 20]);
    assert.deepEqual(twenty.map((group) => group.participantIds.length), [10, 10]);
    const twentyOne = balanceParticipants(Array.from({ length: 21 }, (_, index) => index + 1), [10, 20]);
    assert.deepEqual(twentyOne.map((group) => group.participantIds.length), [11, 10]);
  });

  it('orders ties by points, wins, impostor wins, full tasks and kills', () => {
    const fields=['points','wins','impostorWins','allTasksGames','kills'];
    fields.forEach((field)=>{const first={points:8,wins:2,impostorWins:1,allTasksGames:1,kills:1,[field]:2};const second={points:8,wins:2,impostorWins:1,allTasksGames:1,kills:1,[field]:1};for(const previous of fields.slice(0,fields.indexOf(field)))first[previous]=second[previous];assert.equal(automaticCompare(first,second)<0,true);});
  });

  it('shares absolute positions and flags an unresolved cutoff tie', () => {
    const result = buildCompetitionLeaderboard([match([
      { participantId: 1, name: 'Ana', role:'Crewmate', won:true },
      { participantId: 2, name: 'Bea', role:'Crewmate', won:true },
      { participantId: 3, name: 'Cris', role:'Crewmate', won:false }
    ])], { qualifiers: 1 });
    assert.deepEqual(result.standings.map((row) => row.rank), [1, 1, 3]);
    assert.equal(result.cutoffTie, true);
    assert.deepEqual(result.decisiveTieParticipantIds, [1, 2]);
  });

  it('applies an audited resolution only after all automatic criteria tie', () => {
    const result = buildCompetitionLeaderboard([match([
      { participantId: 1, name: 'Ana', role:'Crewmate', won:true },
      { participantId: 2, name: 'Bea', role:'Crewmate', won:true }
    ])], { qualifiers: 1, resolutions: [{ higherParticipantId: 2, lowerParticipantId: 1 }] });
    assert.deepEqual(result.standings.map((row) => row.participantId), [2, 1]);
    assert.equal(result.cutoffTie, false);
    assert.deepEqual(result.standings.map((row) => row.rank), [1, 2]);
  });

  it('requires a complete auditable order when three players tie at the cutoff',()=>{
    const matches=[match([{participantId:1,name:'Ana',role:'Crewmate',won:true},{participantId:2,name:'Bea',role:'Crewmate',won:true},{participantId:3,name:'Cris',role:'Crewmate',won:true}])];
    const partial=buildCompetitionLeaderboard(matches,{qualifiers:1,resolutions:[{higherParticipantId:2,lowerParticipantId:1}]});
    assert.equal(partial.cutoffTie,true);assert.deepEqual(new Set(partial.decisiveTieParticipantIds),new Set([1,2,3]));assert.deepEqual(partial.standings.map((row)=>row.rank),[1,1,1]);
    const complete=buildCompetitionLeaderboard(matches,{qualifiers:1,resolutions:[{higherParticipantId:2,lowerParticipantId:1},{higherParticipantId:1,lowerParticipantId:3}]});
    assert.equal(complete.cutoffTie,false);assert.deepEqual(complete.standings.map((row)=>row.participantId),[2,1,3]);assert.deepEqual(complete.standings.map((row)=>row.rank),[1,2,3]);
  });

  it('ignores VOID matches and returns per-match score breakdowns', () => {
    const valid = match([{ participantId: 1, name: 'Imp', role: 'Impostor', won: true, kills: 2 }]);
    const invalid = { ...match([{ participantId: 1, name: 'Imp', points: 99 }], 2), status: 'VOID' };
    const result = buildCompetitionLeaderboard([valid, invalid]);
    assert.equal(result.standings[0].points, 7);
    assert.deepEqual(result.standings[0].breakdowns[0].score, { total: 7, victory: 5, kills: 2, tasks: 0 });
  });

  it('ignores points declared by the Reporter and always applies canonical scoring',()=>{
    const result=buildCompetitionLeaderboard([match([{participantId:1,name:'Intento',role:'Crewmate',won:false,points:999,score:999}])]);
    assert.equal(result.standings[0].points,0);
    assert.equal(result.standings[0].breakdowns[0].score.total,0);
  });
});
