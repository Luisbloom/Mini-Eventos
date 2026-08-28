'use strict';

const GROUP_STAGE_MAPS = Object.freeze([
  'The Skeld',
  'Mira HQ',
  'Polus',
  'The Airship',
  'The Fungle'
]);

const FINAL_MAPS = Object.freeze([
  'Polus',
  'The Fungle',
  'Mira HQ',
  'The Airship',
  'The Skeld'
]);

function mapsForStage(stage = {}) {
  return stage.type === 'final' ? FINAL_MAPS : GROUP_STAGE_MAPS;
}

function mapForMatch(stage, matchNumber) {
  const number = Number(matchNumber);
  if (!Number.isInteger(number) || number < 1 || number > 5) return null;
  return mapsForStage(stage)[number - 1] || null;
}

function mapScheduleForStage(stage = {}) {
  const count = Math.min(5, Math.max(0, Number(stage.matchesPerGroup) || 0));
  return Array.from({ length: count }, (_, index) => ({
    matchNumber: index + 1,
    map: mapForMatch(stage, index + 1)
  }));
}

module.exports = {
  GROUP_STAGE_MAPS,
  FINAL_MAPS,
  mapsForStage,
  mapForMatch,
  mapScheduleForStage
};
