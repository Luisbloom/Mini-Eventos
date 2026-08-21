'use strict';

const { calculatePlayerScore, didPlayerWin, isImpostor } = require('./services/scoring');

class CompetitionError extends Error {
  constructor(message, code = 'INVALID_COMPETITION', status = 400) {
    super(message);
    this.name = 'CompetitionError';
    this.code = code;
    this.status = status;
  }
}

function balanceParticipants(participantIds, groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length < 1) throw new CompetitionError('La fase necesita al menos un grupo.');
  const groups = groupIds.map((groupId) => ({ groupId, participantIds: [] }));
  [...participantIds].sort((a, b) => Number(a) - Number(b)).forEach((participantId, index) => {
    groups[index % groups.length].participantIds.push(participantId);
  });
  return groups;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function playerIdentity(player) {
  const participantId = Number(player?.participantId ?? player?.playerId ?? player?.id);
  return Number.isInteger(participantId) && participantId > 0 ? participantId : null;
}

function automaticCompare(first, second) {
  return second.points - first.points
    || second.wins - first.wins
    || second.impostorWins - first.impostorWins
    || second.allTasksGames - first.allTasksGames
    || second.kills - first.kills;
}

function resolutionPath(higherParticipantId, lowerParticipantId, resolutions, visited = new Set()) {
  if (visited.has(higherParticipantId)) return false;
  visited.add(higherParticipantId);
  return resolutions.some((item) => item.higherParticipantId === higherParticipantId
    && (item.lowerParticipantId === lowerParticipantId || resolutionPath(item.lowerParticipantId, lowerParticipantId, resolutions, new Set(visited))));
}

function resolutionCompare(first, second, resolutions) {
  if (resolutionPath(first.participantId, second.participantId, resolutions)) return -1;
  return resolutionPath(second.participantId, first.participantId, resolutions) ? 1 : 0;
}

function buildCompetitionLeaderboard(matches, options = {}) {
  const allowed = options.participantIds ? new Set(options.participantIds.map(Number)) : null;
  const resolutions = options.resolutions || [];
  const players = new Map();
  const validMatches = matches.filter((match) => (match.status || match.matchStatus || 'VALID') === 'VALID');
  for (const match of validMatches) {
    if (!Array.isArray(match.report?.players)) continue;
    for (const player of match.report.players) {
      const participantId = playerIdentity(player);
      if (!participantId || (allowed && !allowed.has(participantId))) continue;
      const name = String(player.name ?? player.playerName ?? `Jugador ${participantId}`).trim();
      const won = didPlayerWin(player, match.report);
      const score = calculatePlayerScore(player, match.report);
      const row = players.get(participantId) || {
        participantId, name, points: 0, wins: 0, impostorWins: 0,
        allTasksGames: 0, kills: 0, games: 0, breakdowns: []
      };
      row.name = name;
      row.points += score.total;
      row.wins += won ? 1 : 0;
      row.impostorWins += won && isImpostor(player) ? 1 : 0;
      row.allTasksGames += !isImpostor(player) && score.tasks > 0 ? 1 : 0;
      row.kills += isImpostor(player) ? finite(player.kills) : 0;
      row.games += 1;
      row.breakdowns.push({ matchId: match.id, score });
      players.set(participantId, row);
    }
  }
  if (allowed) {
    for (const participantId of allowed) {
      if (!players.has(participantId)) players.set(participantId, {
        participantId, name: `Jugador ${participantId}`, points: 0, wins: 0,
        impostorWins: 0, allTasksGames: 0, kills: 0, games: 0, breakdowns: []
      });
    }
  }
  const standings = [...players.values()].sort((first, second) => (
    automaticCompare(first, second)
    || resolutionCompare(first, second, resolutions)
    || first.name.localeCompare(second.name, 'es')
  ));
  const qualifiers = Number(options.qualifiers || 0);
  const clusters=[];
  for(const row of standings){const cluster=clusters.at(-1);if(cluster&&automaticCompare(cluster.rows[0],row)===0)cluster.rows.push(row);else clusters.push({rows:[row]});}
  let cursor=0;let decisiveCluster=null;
  for(const cluster of clusters){cluster.fullyResolved=cluster.rows.length<2||cluster.rows.every((first,index)=>cluster.rows.slice(index+1).every((second)=>resolutionCompare(first,second,resolutions)!==0));cluster.rows.sort((first,second)=>resolutionCompare(first,second,resolutions)||first.name.localeCompare(second.name,'es'));if(qualifiers>cursor&&qualifiers<cursor+cluster.rows.length&&!cluster.fullyResolved)decisiveCluster=cluster;cluster.rows.forEach((row,index)=>{row.rank=cluster.fullyResolved?cursor+index+1:cursor+1;row.winRate=row.games?Math.round((row.wins/row.games)*100):0;});cursor+=cluster.rows.length;}
  standings.splice(0,standings.length,...clusters.flatMap((cluster)=>cluster.rows));
  const cutoffTie=Boolean(decisiveCluster);
  return {
    standings,
    matchCount: validMatches.length,
    cutoffTie,
    decisiveTieParticipantIds: cutoffTie ? decisiveCluster.rows.map((row) => row.participantId) : []
  };
}

module.exports = { CompetitionError, automaticCompare, balanceParticipants, buildCompetitionLeaderboard, resolutionPath };
