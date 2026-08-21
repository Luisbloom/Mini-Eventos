'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SCORING_CONFIG,
  getPublicScoringRules,
  calculatePlayerScore
} = require('../src/services/scoring');

describe('scoring', () => {
  it('awards a crewmate victory and all-tasks bonus', () => {
    const result = calculatePlayerScore({
      role: 'Crewmate',
      won: true,
      tasksCompleted: 7,
      tasksTotal: 7
    });

    assert.deepEqual(result, {
      total: 5,
      victory: 4,
      kills: 0,
      tasks: 1
    });
  });

  it('awards an impostor victory and caps kill points at three', () => {
    const result = calculatePlayerScore({
      role: 'Impostor',
      won: true,
      kills: 8
    });

    assert.deepEqual(result, {
      total: 8,
      victory: 5,
      kills: 3,
      tasks: 0
    });
  });

  it('uses zero as defeat base while retaining earned action bonuses', () => {
    const result = calculatePlayerScore({
      team: 'impostors',
      won: false,
      kills: 2
    });

    assert.deepEqual(result, {
      total: 2,
      victory: 0,
      kills: 2,
      tasks: 0
    });
  });

  it('publishes the exact canonical values for the information page', () => {
    assert.deepEqual(SCORING_CONFIG, {
      crewWin: 4,
      impostorWin: 5,
      kill: 1,
      maxKillBonus: 3,
      allTasks: 1,
      defeat: 0
    });

    assert.deepEqual(getPublicScoringRules().map((rule) => rule.points), [4, 5, 1, 1, 0]);
    assert.equal(getPublicScoringRules()[2].maximum, 3);
  });
});
