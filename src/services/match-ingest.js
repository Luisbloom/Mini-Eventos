'use strict';

const crypto = require('node:crypto');
const { CompetitionError } = require('../competition');
const { fingerprintReport } = require('./report-fingerprint');

const ORIGINS = new Set(['REPORTER', 'MANUAL', 'SIMULATOR']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalReport(report, players) {
  const normalized = {
    ...report,
    reportId: String(report.reportId || '').trim(),
    winner: report.winner ?? report.winnerTeam ?? report.winningTeam ?? null,
    players: players.map((player) => {
      const copy = { ...player, participantId: Number(player.participantId) };
      delete copy.friendCode;
      delete copy.name;
      return copy;
    }).sort((left, right) => left.participantId - right.participantId)
  };
  for (const key of ['eventId', 'stageId', 'groupId', 'hostId', 'matchNumber', 'playedAt', 'winnerTeam', 'winningTeam']) {
    delete normalized[key];
  }
  return JSON.stringify(stableValue(normalized));
}

function canonicalPlayedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? String(value) : instant.toISOString();
}

function createMatchIngestor({ database }) {
  if (!database?.competition) throw new TypeError('Se necesita un repositorio competitivo.');
  return {
    ingest({ eventId, report, context = {}, sourceIp = null, origin = 'REPORTER', submittedBy = null, requireHost = false }) {
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
      const reportId = String(report.reportId || (normalizedOrigin === 'SIMULATOR' ? `sim-${crypto.randomUUID()}` : '')).trim();
      if (!reportId) throw new CompetitionError('reportId es obligatorio.', 'REPORT_ID_REQUIRED');
      const reportFingerprint = fingerprintReport({ ...report, reportId, playedAt: requested.playedAt ?? null });
      const existing = database.findMatchByReportId(event.id, reportId);
      if (requested.stageId === null || requested.stageId === '') {
        if (existing) throw new CompetitionError('reportId ya identifica un resultado diferente.', 'REPORT_ID_CONFLICT', 409);
        throw new CompetitionError('stageId es obligatorio para resultados competitivos.', 'STAGE_REQUIRED');
      }
      let scope;
      try {
        scope = database.competition.validateContext(event.id, requested);
      } catch (error) {
        if (existing) throw new CompetitionError('reportId ya identifica un resultado diferente.', 'REPORT_ID_CONFLICT', 409);
        throw error;
      }
      const matchNumber = Number(requested.matchNumber);
      if (existing) {
        const existingFingerprint = database.getMatchReportFingerprint(existing.id);
        let fallbackPlayers = null;
        if (!existingFingerprint) {
          try {
            fallbackPlayers = database.competition.resolveReportPlayerIdentities(event.id, report.players);
          } catch (_error) {
            throw new CompetitionError('reportId ya identifica un resultado diferente.', 'REPORT_ID_CONFLICT', 409);
          }
        }
        const sameScope = existing.stageId === (scope.stage?.id ?? null)
          && existing.groupId === (scope.group?.id ?? null)
          && existing.hostId === (scope.host?.id ?? null)
          && existing.matchNumber === (Number.isInteger(matchNumber) ? matchNumber : null);
        const suppliedPlayedAt = canonicalPlayedAt(requested.playedAt);
        const samePlayedAt = existingFingerprint
          ? true
          : suppliedPlayedAt === null || suppliedPlayedAt === canonicalPlayedAt(existing.playedAt);
        const sameContent = existingFingerprint
          ? existingFingerprint === reportFingerprint
          : canonicalReport(existing.report, existing.report.players || []) === canonicalReport({ ...report, reportId }, fallbackPlayers);
        if (!sameScope || !samePlayedAt || !sameContent) {
          throw new CompetitionError('reportId ya identifica un resultado diferente.', 'REPORT_ID_CONFLICT', 409);
        }
        return { ...existing, duplicate: true };
      }
      if (requireHost && !scope.host) throw new CompetitionError('hostId es obligatorio para resultados competitivos.', 'HOST_REQUIRED');
      if (!scope.stage.enabled || scope.stage.status !== 'active') throw new CompetitionError('La fase no está activa.', 'STAGE_NOT_ACTIVE', 409);
      if (scope.stage.type === 'group_stage' && !scope.group) throw new CompetitionError('groupId es obligatorio en una fase de grupos.', 'GROUP_REQUIRED');
      if (scope.stage.type === 'final' && scope.group) throw new CompetitionError('La final no admite groupId.', 'FINAL_GROUP_NOT_ALLOWED');
      if (!Number.isInteger(matchNumber) || matchNumber < 1) throw new CompetitionError('matchNumber debe ser un entero positivo.', 'INVALID_MATCH_NUMBER');
      if (matchNumber > scope.stage.matchesPerGroup) throw new CompetitionError('matchNumber supera las partidas previstas para la fase.', 'MATCH_NUMBER_OUT_OF_RANGE');
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
        reportFingerprint,
        origin: normalizedOrigin,
        submittedBy: submittedBy ? String(submittedBy).slice(0, 120) : null
      });
    }
  };
}

module.exports = { createMatchIngestor };
