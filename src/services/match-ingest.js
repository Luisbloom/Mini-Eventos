'use strict';

const crypto = require('node:crypto');
const { CompetitionError } = require('../competition');

const ORIGINS = new Set(['REPORTER', 'MANUAL', 'SIMULATOR']);

function createMatchIngestor({ database }) {
  if (!database?.competition) throw new TypeError('Se necesita un repositorio competitivo.');
  return {
    ingest({ eventId, report, context = {}, sourceIp = null, origin = 'REPORTER', submittedBy = null }) {
      const event = database.getEventById(Number(eventId));
      if (!event || event.archived) throw new CompetitionError('El evento no existe.', 'EVENT_NOT_FOUND', 404);
      if (report.eventId !== undefined && Number(report.eventId) !== event.id) {
        throw new CompetitionError('eventId no coincide con el evento de la ruta.', 'EVENT_CONTEXT_MISMATCH');
      }
      const normalizedOrigin = ORIGINS.has(origin) ? origin : 'REPORTER';
      const requested = {
        stageId: context.stageId ?? report.stageId ?? null,
        groupId: context.groupId ?? report.groupId ?? null,
        hostId: context.hostId ?? report.hostId ?? null,
        matchNumber: context.matchNumber ?? report.matchNumber ?? null,
        playedAt: context.playedAt ?? report.playedAt ?? null
      };
      const scope = database.competition.validateContext(event.id, requested);
      if (!scope.stage) throw new CompetitionError('stageId es obligatorio para resultados competitivos.', 'STAGE_REQUIRED');
      if (!scope.stage.enabled || scope.stage.status !== 'active') throw new CompetitionError('La fase no está activa.', 'STAGE_NOT_ACTIVE', 409);
      if (scope.stage.type === 'group_stage' && !scope.group) throw new CompetitionError('groupId es obligatorio en una fase de grupos.', 'GROUP_REQUIRED');
      if (scope.stage.type === 'final' && scope.group) throw new CompetitionError('La final no admite groupId.', 'FINAL_GROUP_NOT_ALLOWED');
      const matchNumber = Number(requested.matchNumber);
      if (!Number.isInteger(matchNumber) || matchNumber < 1) throw new CompetitionError('matchNumber debe ser un entero positivo.', 'INVALID_MATCH_NUMBER');
      if (matchNumber > scope.stage.matchesPerGroup) throw new CompetitionError('matchNumber supera las partidas previstas para la fase.', 'MATCH_NUMBER_OUT_OF_RANGE');
      const reportId = String(report.reportId || (normalizedOrigin === 'SIMULATOR' ? `sim-${crypto.randomUUID()}` : '')).trim();
      if (!reportId) throw new CompetitionError('reportId es obligatorio.', 'REPORT_ID_REQUIRED');
      const occupied=database.competition.findValidMatchBySlot(event.id,scope.stage.id,scope.group?.id??null,matchNumber);
      if(occupied&&occupied.reportId!==reportId)throw new CompetitionError('Ese número de partida ya tiene un resultado válido. Anúlalo antes de reenviarlo.','MATCH_SLOT_OCCUPIED',409);
      const players = database.competition.resolveReportPlayers(event.id, scope.stage.id, scope.group?.id ?? null, report.players);
      if(new Set(players.map((player)=>player.participantId)).size!==players.length)throw new CompetitionError('Un jugador no puede aparecer dos veces en la misma partida.','DUPLICATE_REPORT_PLAYER');
      const normalizedReport = {
        ...report,
        reportId,
        winner: report.winner ?? report.winnerTeam ?? report.winningTeam ?? null,
        players
      };
      delete normalizedReport.eventId;
      delete normalizedReport.stageId;
      delete normalizedReport.groupId;
      delete normalizedReport.hostId;
      delete normalizedReport.matchNumber;
      delete normalizedReport.playedAt;
      return database.insertMatch(normalizedReport, sourceIp, event.id, {
        stageId: scope.stage.id,
        groupId: scope.group?.id ?? null,
        hostId: scope.host?.id ?? null,
        matchNumber,
        playedAt: requested.playedAt || new Date().toISOString(),
        origin: normalizedOrigin,
        submittedBy: submittedBy ? String(submittedBy).slice(0, 120) : null
      });
    }
  };
}

module.exports = { createMatchIngestor };
