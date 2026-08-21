'use strict';

const { calculatePlayerScore, didPlayerWin, isImpostor } = require('./services/scoring');

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es');
}

function buildLeaderboard(matches) {
  const players = new Map();
  let lastUpdated = null;
  let hasDemoData = false;

  for (const match of matches) {
    const report = match?.report;
    if (!report || typeof report !== 'object') {
      continue;
    }

    if (report.demo === true) {
      hasDemoData = true;
    }

    if (match.receivedAt && (!lastUpdated || match.receivedAt > lastUpdated)) {
      lastUpdated = match.receivedAt;
    }

    if (!Array.isArray(report.players)) {
      continue;
    }

    for (const player of report.players) {
      if (!player || typeof player !== 'object') {
        continue;
      }

      const name = String(player.name ?? player.playerName ?? '').trim();
      if (!name) {
        continue;
      }

      const playerId = String(player.playerId ?? player.id ?? normalized(name));
      const won = didPlayerWin(player, report);
      const hasExplicitPoints = player.points !== undefined || player.score !== undefined;
      const points = hasExplicitPoints
        ? finiteNumber(player.points ?? player.score)
        : calculatePlayerScore(player, report).total;
      const existing = players.get(playerId) || {
        playerId,
        name,
        color: 'gray',
        points: 0,
        wins: 0,
        impostorWins: 0,
        games: 0,
        kills: 0
      };

      existing.name = name;
      existing.color = String(player.color ?? existing.color);
      existing.points += points;
      existing.wins += won ? 1 : 0;
      existing.impostorWins += won && isImpostor(player) ? 1 : 0;
      existing.games += 1;
      existing.kills += finiteNumber(player.kills);
      players.set(playerId, existing);
    }
  }

  const standings = [...players.values()]
    .sort((first, second) => (
      second.points - first.points
      || second.wins - first.wins
      || second.impostorWins - first.impostorWins
      || second.kills - first.kills
      || first.name.localeCompare(second.name, 'es')
    ))
    .map((player, index) => ({
      rank: index + 1,
      ...player,
      winRate: player.games ? Math.round((player.wins / player.games) * 100) : 0
    }));

  return {
    standings,
    matchCount: matches.length,
    playerCount: standings.length,
    lastUpdated,
    hasDemoData
  };
}

module.exports = { buildLeaderboard };
