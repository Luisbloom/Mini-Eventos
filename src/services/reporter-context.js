'use strict';

const { friendCodeFingerprint, normalizeFriendCode } = require('./friend-code');

// Resuelve el contexto competitivo que un Tournament Reporter debe usar para su
// próxima partida. El Reporter nunca deduce fase, grupo ni número de partida:
// si aquí no hay una respuesta inequívoca, `reportingEnabled` es false y el
// Reporter guarda el resultado sin enviarlo.

const DISABLED_REASONS = Object.freeze({
  EVENT_ARCHIVED: 'El evento está archivado.',
  MATCHES_DISABLED: 'El evento no admite resultados de partidas.',
  HOST_DISABLED: 'El host está desactivado en el panel de administración.',
  HOST_NOT_ASSIGNED: 'El host no tiene fase asignada. Asígnasela desde /admin.',
  STAGE_NOT_FOUND: 'La fase asignada al host ya no existe. Vuelve a asignarla desde /admin.',
  STAGE_DISABLED: 'La fase asignada al host está deshabilitada.',
  STAGE_NOT_ACTIVE: 'La fase asignada al host no está activa.',
  GROUP_NOT_ASSIGNED: 'La fase es de grupos y el host no tiene grupo asignado.',
  GROUP_NOT_FOUND: 'El grupo asignado al host ya no existe. Vuelve a asignarlo desde /admin.',
  GROUP_STAGE_MISMATCH: 'El grupo asignado ya no pertenece a la fase asignada.',
  STAGE_GROUP_NOT_ALLOWED: 'La fase asignada no admite grupo. Corrige la asignación desde /admin.',
  ALL_MATCHES_PLAYED: 'Todas las partidas previstas para esa fase y grupo ya tienen resultado válido.'
});

function publicStage(stage) {
  return {
    id: stage.id,
    name: stage.name,
    type: stage.type,
    status: stage.status,
    matchesPerGroup: stage.matchesPerGroup
  };
}

function publicGroup(group) {
  return group ? { id: group.id, name: group.name } : null;
}

// El Reporter necesita saber a quién puede incluir en el resultado sin recibir
// ningún Friend Code: publicamos sólo la huella del código normalizado.
function publicHost(host) {
  return { id: host.id, identifier: host.identifier, name: host.name, enabled: host.enabled };
}

function disabled(base, reason) {
  return { ...base, reportingEnabled: false, reason, message: DISABLED_REASONS[reason] || reason };
}

function createReporterContextResolver({ database }) {
  if (!database?.competition) throw new TypeError('Se necesita un repositorio competitivo.');
  const { competition } = database;

  return {
    resolve({ event, host, includeRoster = true }) {
      const base = {
        event: { id: event.id, slug: event.slug, name: event.name },
        host: publicHost(host),
        stage: null,
        group: null,
        matchNumber: null,
        occupiedMatchNumbers: [],
        roster: [],
        rosterSize: 0,
        rosterWithoutFriendCode: 0,
        submitPath: `/api/events/${event.slug}/matches`,
        serverTime: new Date().toISOString()
      };

      if (event.archived) return disabled(base, 'EVENT_ARCHIVED');
      if (!event.modules?.matches) return disabled(base, 'MATCHES_DISABLED');
      if (!host.enabled) return disabled(base, 'HOST_DISABLED');
      if (!host.assignedStageId) return disabled(base, 'HOST_NOT_ASSIGNED');

      let stage;
      try {
        stage = competition.getStage(host.assignedStageId);
      } catch {
        return disabled(base, 'STAGE_NOT_FOUND');
      }
      if (stage.eventId !== event.id) return disabled(base, 'STAGE_NOT_FOUND');
      base.stage = publicStage(stage);
      if (!stage.enabled) return disabled(base, 'STAGE_DISABLED');
      if (stage.status !== 'active') return disabled(base, 'STAGE_NOT_ACTIVE');

      let group = null;
      if (stage.type === 'group_stage') {
        if (!host.assignedGroupId) return disabled(base, 'GROUP_NOT_ASSIGNED');
        try {
          group = competition.getGroup(host.assignedGroupId);
        } catch {
          return disabled(base, 'GROUP_NOT_FOUND');
        }
        if (group.stageId !== stage.id) return disabled(base, 'GROUP_STAGE_MISMATCH');
        base.group = publicGroup(group);
      } else if (host.assignedGroupId) {
        return disabled(base, 'STAGE_GROUP_NOT_ALLOWED');
      }

      const occupied = competition.listOccupiedMatchNumbers(event.id, stage.id, group?.id ?? null);
      base.occupiedMatchNumbers = occupied;
      const taken = new Set(occupied);
      let matchNumber = null;
      for (let candidate = 1; candidate <= stage.matchesPerGroup; candidate += 1) {
        if (!taken.has(candidate)) { matchNumber = candidate; break; }
      }
      if (matchNumber === null) return disabled(base, 'ALL_MATCHES_PLAYED');

      const rosterRows = competition.listReporterRoster(event.id, stage.id, group?.id ?? null);
      const roster = rosterRows.map((member) => ({
        participantId: member.participantId,
        displayName: member.displayName,
        friendCodeFingerprint: friendCodeFingerprint(member.internalFriendCode)
      }));
      const scope = [host.identifier, stage.name, group?.name, `partida ${matchNumber}`]
        .filter(Boolean)
        .join(' · ');
      return {
        ...base,
        matchNumber,
        roster: includeRoster ? roster : [],
        rosterSize: roster.length,
        rosterWithoutFriendCode: roster.filter((member) => !member.friendCodeFingerprint).length,
        reportingEnabled: true,
        reason: null,
        message: scope
      };
    }
  };
}

module.exports = { DISABLED_REASONS, createReporterContextResolver, friendCodeFingerprint, normalizeFriendCode };
