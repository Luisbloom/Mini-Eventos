'use strict';

/**
 * Lógica de presentación del draft y de la inscripción, sin tocar el DOM.
 *
 * Vive aparte para poder probarla en Node: decidir qué se enseña y quién puede
 * pulsar qué es justo lo que no debe romperse, y hacerlo depender de un
 * navegador significaría no probarlo nunca.
 *
 * Nada de aquí es autoridad: el backend vuelve a comprobarlo todo. Esto sólo
 * decide qué pinta la pantalla.
 */

/** Todo lo que escribe una persona pasa por aquí antes de ir a innerHTML. */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Iniciales para el hueco del avatar: no traemos la imagen de Discord. */
function initials(name) {
  const pieces = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return pieces.map((piece) => piece[0]).join('').toUpperCase() || '?';
}

// ----------------------------------------------------------- inscripción

/**
 * Qué pantalla toca. El orden importa: primero lo que impide seguir, después
 * lo que ya está hecho, y al final el formulario.
 */
function registrationState({ discordConfigured, me }) {
  const event = me?.event || {};
  if (!me?.authenticated) return discordConfigured ? 'login' : 'unavailable';
  if (event.registered) return 'registered';
  if (!event.registrationsOpen) return 'closed';
  return 'form';
}

// --------------------------------------------------------------- draft

const DRAFT_LABELS = Object.freeze({
  PENDING: 'PENDIENTE',
  ACTIVE: 'EN DIRECTO',
  PAUSED: 'PAUSADO',
  COMPLETED: 'FINALIZADO'
});

function draftLabel(status) {
  return DRAFT_LABELS[status] || 'PENDIENTE';
}

/** El equipo al que le toca ahora, o null si el draft no está en marcha. */
function currentTeam(draft) {
  if (!draft || draft.status !== 'ACTIVE') return null;
  return draft.teams?.find((team) => team.id === draft.currentTeamId) || null;
}

/**
 * Qué puede hacer quien está mirando. `me` viene de /api/me y el backend
 * vuelve a comprobarlo en cada elección: esto sólo decide si se dibuja el botón.
 */
function viewerRole(draft, me) {
  if (!me?.authenticated) return 'visitor';
  const participantId = me.event?.participantId ?? null;
  if (!participantId) return 'visitor';
  const equipo = draft?.teams?.find((team) => team.captainParticipantId === participantId);
  if (!equipo) return 'participant';
  return 'captain';
}

/** Si el visitante es el capitán al que le toca elegir ahora mismo. */
function canPick(draft, me) {
  if (draft?.status !== 'ACTIVE') return false;
  if (viewerRole(draft, me) !== 'captain') return false;
  const turno = currentTeam(draft);
  return Boolean(turno && turno.captainParticipantId === me.event.participantId);
}

/** Los cinco huecos de un equipo: los ocupados y los que faltan. */
function teamSlots(team, teamSize) {
  const miembros = [...(team.members || [])].sort(
    (left, right) => (left.role === 'captain' ? -1 : 0) - (right.role === 'captain' ? -1 : 0)
  );
  const huecos = Math.max(0, Number(teamSize || 5) - miembros.length);
  return [...miembros, ...Array.from({ length: huecos }, () => null)];
}

/** Una línea de texto con la situación, para la cabecera. */
function draftHeadline(draft) {
  if (!draft) return '';
  if (draft.status === 'PENDING') return 'El draft todavía no ha empezado.';
  if (draft.status === 'PAUSED') return 'El draft está pausado por la organización.';
  if (draft.status === 'COMPLETED') return 'Draft terminado. Equipos completos.';
  const equipo = currentTeam(draft);
  return equipo ? `Turno de ${equipo.name}` : 'Esperando turno.';
}

/**
 * Junta los avisos del canal en directo para no lanzar varias peticiones a la
 * vez. Si llega uno mientras hay otra en curso, se recuerda y se hace una sola
 * más al terminar.
 */
function createRefreshQueue(run) {
  let running = false;
  let pending = false;

  return async function schedule() {
    if (running) { pending = true; return; }
    running = true;
    try {
      do {
        pending = false;
        await run();
      } while (pending);
    } finally {
      running = false;
    }
  };
}

const DRAFT_VIEW = {
  escapeHtml, initials,
  registrationState,
  draftLabel, currentTeam, viewerRole, canPick, teamSlots, draftHeadline,
  createRefreshQueue
};

if (typeof module !== 'undefined' && module.exports) module.exports = DRAFT_VIEW;
if (typeof window !== 'undefined') window.DraftView = DRAFT_VIEW;
