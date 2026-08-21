'use strict';

const SCORING_CONFIG = Object.freeze({
  crewWin: 4,
  impostorWin: 5,
  kill: 1,
  maxKillBonus: 3,
  allTasks: 1,
  defeat: 0
});

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es');
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isImpostor(player) {
  const role = normalized(player?.role ?? player?.team ?? player?.faction);
  return role.includes('impost') || role === 'traitor';
}

function didPlayerWin(player, report = {}) {
  if (typeof player?.won === 'boolean') {
    return player.won;
  }

  const winningTeam = normalized(report.winner ?? report.winningTeam);
  const playerTeam = normalized(player?.team ?? player?.faction);
  return Boolean(winningTeam && playerTeam && winningTeam === playerTeam);
}

function completedAllTasks(player) {
  if (player?.allTasksCompleted === true) {
    return true;
  }

  const completed = finiteNonNegative(player?.tasksCompleted);
  const total = finiteNonNegative(player?.tasksTotal ?? player?.totalTasks);
  return total > 0 && completed >= total;
}

function calculatePlayerScore(player, report = {}) {
  const impostor = isImpostor(player);
  const won = didPlayerWin(player, report);
  const victory = won
    ? (impostor ? SCORING_CONFIG.impostorWin : SCORING_CONFIG.crewWin)
    : SCORING_CONFIG.defeat;
  const kills = impostor
    ? Math.min(
      Math.floor(finiteNonNegative(player?.kills)) * SCORING_CONFIG.kill,
      SCORING_CONFIG.maxKillBonus
    )
    : 0;
  const tasks = !impostor && completedAllTasks(player) ? SCORING_CONFIG.allTasks : 0;

  return {
    total: victory + kills + tasks,
    victory,
    kills,
    tasks
  };
}

function getPublicScoringRules() {
  return [
    { key: 'crewWin', label: 'Victoria como tripulante', points: SCORING_CONFIG.crewWin },
    { key: 'impostorWin', label: 'Victoria como impostor', points: SCORING_CONFIG.impostorWin },
    {
      key: 'kill',
      label: 'Cada kill como impostor',
      points: SCORING_CONFIG.kill,
      maximum: SCORING_CONFIG.maxKillBonus
    },
    { key: 'allTasks', label: 'Completar todas tus tareas', points: SCORING_CONFIG.allTasks },
    { key: 'defeat', label: 'Derrota', points: SCORING_CONFIG.defeat }
  ];
}

module.exports = {
  SCORING_CONFIG,
  calculatePlayerScore,
  didPlayerWin,
  getPublicScoringRules,
  isImpostor
};
