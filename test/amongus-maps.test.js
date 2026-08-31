'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapForMatch, mapScheduleForStage } = require('../src/amongus-maps');

describe('distribución de mapas de Among Us', () => {
  it('usa los cinco mapas una vez y en el mismo orden en ambos grupos', () => {
    const schedule = mapScheduleForStage({ type: 'group_stage', matchesPerGroup: 5 });
    assert.deepEqual(schedule.map((slot) => slot.map), [
      'The Skeld', 'Mira HQ', 'Polus', 'The Airship', 'The Fungle'
    ]);
    assert.equal(new Set(schedule.map((slot) => slot.map)).size, 5);
  });

  it('reordena los cinco mapas para la gran final y termina en The Skeld', () => {
    const schedule = mapScheduleForStage({ type: 'final', matchesPerGroup: 5 });
    assert.deepEqual(schedule.map((slot) => slot.map), [
      'Polus', 'The Fungle', 'Mira HQ', 'The Airship', 'The Skeld'
    ]);
    assert.equal(new Set(schedule.map((slot) => slot.map)).size, 5);
    assert.equal(mapForMatch({ type: 'final' }, 5), 'The Skeld');
  });

  it('no inventa mapas fuera de las cinco partidas planificadas', () => {
    assert.equal(mapForMatch({ type: 'group_stage' }, 0), null);
    assert.equal(mapForMatch({ type: 'group_stage' }, 6), null);
  });
});
