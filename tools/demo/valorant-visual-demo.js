'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('../../src/database');
const { SLOTS } = require('../../src/services/playoffs/bracket');

const EVENT_SLUG = 'torneo-valorant';
const ADMIN_TOKEN = 'demo-admin';
const TEAM_NAMES = Object.freeze([
  'Jarti Phoenix',
  'Nebula Five',
  'Costa Vandal',
  'Lobos de Bind'
]);
const MAPS = Object.freeze(['ascent', 'bind', 'haven', 'lotus', 'split']);
const AGENTS = Object.freeze([
  'Jett', 'Sova', 'Omen', 'Killjoy', 'Sage',
  'Raze', 'Fade', 'Viper', 'Cypher', 'Skye'
]);

function statsForSeries(series, teams, index) {
  const participants = teams
    .filter((team) => team.id === series.teamAId || team.id === series.teamBId)
    .flatMap((team) => team.members.map((member, memberIndex) => ({
      participantId: member.participantId,
      teamId: team.id,
      agent: AGENTS[(index + memberIndex + team.seed) % AGENTS.length],
      acs: 185 + ((index * 13 + memberIndex * 17 + team.seed * 7) % 115),
      kills: 14 + ((index + memberIndex * 2 + team.seed) % 13),
      deaths: 11 + ((index * 2 + memberIndex + team.seed) % 11),
      assists: 3 + ((index + memberIndex * 3) % 12),
      plusMinus: 0,
      adr: 118 + ((index * 7 + memberIndex * 11) % 72),
      hsPercent: 18 + ((index + memberIndex * 4) % 27),
      kastPercent: 61 + ((index * 3 + memberIndex * 2) % 25),
      firstKills: (index + memberIndex) % 5,
      firstDeaths: (index + memberIndex + 2) % 4
    })));

  return participants.map((participant) => ({
    ...participant,
    plusMinus: participant.kills - participant.deaths
  }));
}

function completeSeries(database, eventId, series, winnerTeamId, index, teams) {
  const winsNeeded = Math.floor(series.bestOf / 2) + 1;
  let current = series;

  for (let gameNumber = 1; gameNumber <= winsNeeded; gameNumber += 1) {
    current = database.valorantCompetition.assignMap(eventId, {
      seriesId: series.id,
      gameNumber,
      mapKey: MAPS[(index + gameNumber - 1) % MAPS.length]
    });
    const winnerIsA = current.teamAId === winnerTeamId;
    current = database.valorantCompetition.recordGameResult(eventId, {
      seriesId: series.id,
      gameNumber,
      teamARounds: winnerIsA ? 13 : 7 + ((index + gameNumber) % 3),
      teamBRounds: winnerIsA ? 7 + ((index + gameNumber) % 3) : 13,
      source: 'MANUAL',
      reason: 'Datos reproducibles de la demo visual',
      actor: 'demo-seed',
      stats: statsForSeries(current, teams, index + gameNumber)
    });
  }

  return current;
}

function seedValorantDemo(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = openDatabase(dbPath);

  try {
    const event = database.createEvent({
      slug: EVENT_SLUG,
      name: 'Torneo Valorant — Liga Jartiland',
      game: 'Valorant',
      description: 'Demo visual completa con draft, liga regular, clasificación y playoffs.',
      status: 'Inscripciones abiertas',
      registrationsOpen: true,
      minParticipants: 20,
      maxParticipants: 20,
      modules: {
        information: true,
        participants: true,
        leaderboard: true,
        matches: true,
        registration: true,
        competition: true,
        schedule: true,
        prizes: true,
        draft: true
      },
      accentColor: '#ff4655',
      icon: 'crosshair',
      coverImage: '/images/events/valorant-cover.jpg'
    });

    const participants = [];
    for (let index = 1; index <= 20; index += 1) {
      const created = database.createParticipant(event.id, {
        discord_username: `demo.valorant.${String(index).padStart(2, '0')}`,
        game_name: `Jugador ${String(index).padStart(2, '0')}`
      });
      participants.push(database.updateParticipant(created.id, { status: 'confirmed' }));
    }

    database.updateEvent(event.id, { status: 'En curso', registrationsOpen: false });

    database.valorant.configureDraft(event.id, {
      captains: participants.slice(0, 4).map((participant) => participant.id),
      teamCount: 4,
      teamSize: 5,
      actor: 'demo-seed'
    });
    database.valorant.startDraft(event.id, { actor: 'demo-seed' });

    for (const participant of participants.slice(4)) {
      const draft = database.valorant.getDraft(event.id);
      const turn = database.valorant.teamForPick(event.id, draft.currentPick);
      database.valorant.pick(event.id, {
        captainParticipantId: turn.team.captainParticipantId,
        selectedParticipantId: participant.id
      });
    }

    let teams = database.valorant.listTeams(event.id);
    teams.forEach((team, index) => {
      database.valorant.renameTeam(event.id, {
        teamId: team.id,
        name: TEAM_NAMES[index],
        actor: 'demo-seed',
        reason: 'Nombre visible para la demo'
      });
    });
    teams = database.valorant.listTeams(event.id);

    database.valorantCompetition.generateRegularSeason(event.id, teams.map((team) => team.id));
    const seedByTeam = new Map(teams.map((team) => [team.id, team.seed]));
    database.valorantCompetition.listSeries(event.id, 'REGULAR').forEach((series, index) => {
      const winnerTeamId = seedByTeam.get(series.teamAId) < seedByTeam.get(series.teamBId)
        ? series.teamAId
        : series.teamBId;
      completeSeries(database, event.id, series, winnerTeamId, index, teams);
    });

    database.valorantPlayoffs.generate(event.id, teams);
    let playoffs = database.valorantPlayoffs.listSeries(event.id);
    for (const [index, slot] of [SLOTS.UPPER_SEMI_1, SLOTS.UPPER_SEMI_2].entries()) {
      const series = playoffs.find((candidate) => candidate.slot === slot);
      completeSeries(database, event.id, series, series.teamAId, 20 + index * 3, teams);
    }

    playoffs = database.valorantPlayoffs.listSeries(event.id);
    for (const slot of [SLOTS.UPPER_FINAL, SLOTS.LOWER_ROUND_1]) {
      const series = playoffs.find((candidate) => candidate.slot === slot);
      MAPS.slice(0, series.bestOf).forEach((mapKey, index) => {
        database.valorantCompetition.assignMap(event.id, {
          seriesId: series.id,
          gameNumber: index + 1,
          mapKey
        });
      });
    }

    return summarizeDemo(database, event.id, dbPath);
  } finally {
    database.close();
  }
}

function summarizeDemo(database, eventId, dbPath) {
  const event = database.getEventById(eventId);
  const draft = database.valorant.getDraft(eventId);
  const teams = database.valorant.listTeams(eventId);
  const regular = database.valorantCompetition.listSeries(eventId, 'REGULAR');
  const standings = database.valorantCompetition.standings(eventId, { teams });
  const playoffs = database.valorantPlayoffs.listSeries(eventId);
  return {
    dbPath,
    eventId,
    slug: event.slug,
    participants: event.participantCount,
    draft: draft?.status ?? null,
    teams: teams.length,
    regularSeries: regular.length,
    regularCompleted: regular.filter((series) => series.status === 'COMPLETED').length,
    standings: standings.standings.length,
    qualified: standings.standings.filter((row) => row.qualified).length,
    playoffsGenerated: playoffs.length > 0,
    playoffSeries: playoffs.length,
    playoffCompleted: playoffs.filter((series) => series.status === 'COMPLETED').length
  };
}

function defaultPaths() {
  const dataDir = path.resolve(__dirname, '../../.tmp/demo-visual');
  return {
    dataDir,
    dbPath: path.join(dataDir, 'demo.db'),
    uploads: path.join(dataDir, 'uploads')
  };
}

function resetDefaultDemo(paths) {
  const expected = path.resolve(__dirname, '../../.tmp/demo-visual');
  if (path.resolve(paths.dataDir) !== expected) {
    throw new Error('La demo sólo puede reiniciar su directorio desechable conocido.');
  }
  fs.rmSync(expected, { recursive: true, force: true });
  fs.mkdirSync(paths.uploads, { recursive: true });
}

if (require.main === module) {
  const paths = defaultPaths();
  resetDefaultDemo(paths);
  const summary = seedValorantDemo(paths.dbPath);
  process.stdout.write(`${JSON.stringify({ event: 'demo_seeded', ...summary })}\n`);

  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3200';
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.DATA_DIR = paths.dataDir;
  process.env.DB_PATH = paths.dbPath;
  process.env.CAPTURE_STORAGE_ROOT = paths.uploads;
  process.env.NODE_ENV = 'development';
  require('../../src/server');
}

module.exports = {
  ADMIN_TOKEN,
  EVENT_SLUG,
  defaultPaths,
  seedValorantDemo,
  summarizeDemo
};
