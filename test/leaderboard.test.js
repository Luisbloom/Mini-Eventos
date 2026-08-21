'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildLeaderboard } = require('../src/leaderboard');

describe('leaderboard', () => {
  it('aggregates players and sorts them by points, wins and kills', () => {
    const result = buildLeaderboard([
      {
        receivedAt: '2026-08-21T20:00:00.000Z',
        report: {
          demo: true,
          players: [
            { playerId: 'ana', name: 'Ana', points: 5, won: true, kills: 2, color: 'red' },
            { playerId: 'leo', name: 'Leo', points: 3, won: false, kills: 1, color: 'blue' }
          ]
        }
      },
      {
        receivedAt: '2026-08-21T21:00:00.000Z',
        report: {
          demo: true,
          players: [
            { playerId: 'ana', name: 'ANA', points: 2, won: false, kills: 1, color: 'red' },
            { playerId: 'leo', name: 'Leo', points: 6, won: true, kills: 3, color: 'blue' }
          ]
        }
      }
    ]);

    assert.equal(result.matchCount, 2);
    assert.equal(result.playerCount, 2);
    assert.equal(result.hasDemoData, true);
    assert.equal(result.lastUpdated, '2026-08-21T21:00:00.000Z');
    assert.deepEqual(result.standings, [
      {
        rank: 1,
        playerId: 'leo',
        name: 'Leo',
        color: 'blue',
        points: 9,
        wins: 1,
        impostorWins: 0,
        games: 2,
        kills: 4,
        winRate: 50
      },
      {
        rank: 2,
        playerId: 'ana',
        name: 'ANA',
        color: 'red',
        points: 7,
        wins: 1,
        impostorWins: 0,
        games: 2,
        kills: 3,
        winRate: 50
      }
    ]);
  });

  it('uses canonical crew victory points and ignores malformed players', () => {
    const result = buildLeaderboard([
      {
        receivedAt: '2026-08-21T21:00:00.000Z',
        report: {
          winner: 'crewmates',
          players: [
            { name: 'Marta', team: 'crewmates' },
            { name: 'Dani', team: 'impostors' },
            null,
            { role: 'Crewmate' }
          ]
        }
      }
    ]);

    assert.deepEqual(result.standings.map((player) => ({
      name: player.name,
      points: player.points,
      wins: player.wins
    })), [
      { name: 'Marta', points: 4, wins: 1 },
      { name: 'Dani', points: 0, wins: 0 }
    ]);
  });

  it('returns an empty tournament without inventing players', () => {
    assert.deepEqual(buildLeaderboard([]), {
      standings: [],
      matchCount: 0,
      playerCount: 0,
      lastUpdated: null,
      hasDemoData: false
    });
  });

  it('uses canonical scoring when the Reporter does not send points', () => {
    const result = buildLeaderboard([{
      receivedAt: '2026-08-21T21:00:00.000Z',
      report: {
        players: [
          { name: 'Crew', role: 'Crewmate', won: true, tasksCompleted: 4, tasksTotal: 4 },
          { name: 'Imp', role: 'Impostor', won: true, kills: 2 }
        ]
      }
    }]);

    assert.deepEqual(result.standings.map((player) => [player.name, player.points]), [
      ['Imp', 7],
      ['Crew', 5]
    ]);
    assert.equal(result.standings[0].impostorWins, 1);
  });
});
