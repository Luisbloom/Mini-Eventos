'use strict';

/**
 * Panel del draft. Sólo aparece en eventos con el módulo activado, así que un
 * torneo individual como el de Among Us no lo ve nunca.
 *
 * El backend vuelve a comprobarlo todo: aquí los botones se apagan para no
 * dejar pulsar lo que va a fallar, no para autorizar nada.
 */

(() => {
  const id = (name) => document.getElementById(name);
  const seccion = () => id('draft-admin-section');

  let evento = null;
  let confirmados = [];
  let draft = null;
  let equipos = [];
  let capitanes = [];      // orden elegido, por participantId
  let numeroDeEquipos = 4; // lo que hay elegido en pantalla, guardado o no
  let stream = null;

  const api = (ruta, opciones) => window.adminApi
    ? window.adminApi(ruta, opciones)
    : fetch(ruta, opciones).then((r) => r.json());

  function aviso(texto, error = false) {
    const caja = id('draft-admin-feedback');
    caja.textContent = texto || '';
    caja.classList.toggle('error', Boolean(error));
  }

  // ------------------------------------------------------------- pintar

  function resumen() {
    // El resumen sigue al selector, no a lo guardado: así se ve lo que va a
    // pasar antes de guardarlo.
    const plan = window.DraftView.draftPlan(numeroDeEquipos, window.DraftView.TEAM_SIZE);
    const filas = [
      ['Participantes confirmados', `${confirmados.length} / ${plan.participantsNeeded}`],
      ['Capitanes', `${capitanes.filter(Boolean).length} / ${plan.captains}`],
      ['Jugadores por elegir', String(plan.totalPicks)],
      ['Equipos', String(plan.teamCount)],
      ['Jugadores por equipo', String(plan.teamSize)]
    ];
    id('draft-admin-summary').replaceChildren(...filas.flatMap(([clave, valor]) => {
      const caja = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = clave;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      caja.append(dt, dd);
      return [caja];
    }));
  }

  /** Nombre y Riot ID; nunca nada de Discord. */
  function etiqueta(persona) {
    return persona.riotId ? `${persona.displayName} · ${persona.riotId}` : persona.displayName;
  }

  function selectorDeCapitan(indice) {
    const fila = document.createElement('li');

    const puesto = document.createElement('span');
    puesto.className = 'draft-captain-seat';
    puesto.textContent = String(indice + 1);

    const selector = document.createElement('select');
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '— sin asignar —';
    selector.append(vacio);

    for (const persona of confirmados) {
      // Quien ya es capitán en otro puesto no puede repetirse.
      const ocupadoEnOtro = capitanes.some((valor, otro) => otro !== indice && valor === persona.participantId);
      if (ocupadoEnOtro) continue;
      const opcion = document.createElement('option');
      opcion.value = String(persona.participantId);
      opcion.textContent = etiqueta(persona);
      if (capitanes[indice] === persona.participantId) opcion.selected = true;
      selector.append(opcion);
    }
    selector.addEventListener('change', () => {
      capitanes[indice] = selector.value ? Number(selector.value) : null;
      pintarCapitanes();
    });

    const subir = document.createElement('button');
    subir.type = 'button';
    subir.className = 'draft-move';
    subir.textContent = '↑';
    subir.disabled = indice === 0;
    subir.addEventListener('click', () => intercambiar(indice, indice - 1));

    const bajar = document.createElement('button');
    bajar.type = 'button';
    bajar.className = 'draft-move';
    bajar.textContent = '↓';
    bajar.disabled = indice === capitanes.length - 1;
    bajar.addEventListener('click', () => intercambiar(indice, indice + 1));

    fila.append(puesto, selector, subir, bajar);
    return fila;
  }

  function intercambiar(uno, otro) {
    [capitanes[uno], capitanes[otro]] = [capitanes[otro], capitanes[uno]];
    pintarCapitanes();
  }

  function pintarCapitanes() {
    id('draft-captains').replaceChildren(
      ...capitanes.map((_, indice) => selectorDeCapitan(indice)));
    resumen();

    // Un solo sitio decide si se puede empezar y por qué no. Antes el botón y
    // el mensaje se calculaban por separado y podían no coincidir: se podía
    // cambiar un capitán, no guardar, y arrancar con otros de los que se veían.
    const motivo = window.DraftView.startBlockedReason({
      selected: capitanes,
      savedTeams: equipos,
      confirmedCount: confirmados.length,
      teamCount: numeroDeEquipos,
      teamSize: window.DraftView.TEAM_SIZE,
      status: draft?.status
    });
    id('start-draft').disabled = Boolean(motivo);
    aviso(motivo || '');

    const nota = id('draft-format-note');
    if (nota) {
      const plan = window.DraftView.draftPlan(numeroDeEquipos, window.DraftView.TEAM_SIZE);
      nota.textContent = `${plan.participantsNeeded} inscritos confirmados, ${plan.captains} capitanes y ${plan.totalPicks} elecciones.`;
    }
  }

  function pintarFormato() {
    const selector = id('draft-team-count');
    if (!selector) return;
    selector.value = String(numeroDeEquipos);
    // Con el draft en marcha el formato ya no se toca.
    selector.disabled = Boolean(draft && draft.status !== 'PENDING');
  }

  function cambiarNumeroDeEquipos(valor) {
    numeroDeEquipos = Number(valor) || 4;
    // Se conservan los capitanes que ya estaban y se ajusta el número de huecos.
    const anteriores = [...capitanes];
    capitanes = Array.from({ length: numeroDeEquipos }, (_, i) => anteriores[i] ?? null);
    pintarCapitanes();
  }

  function pintarEnCurso() {
    const enMarcha = draft && ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(draft.status);
    id('draft-live-block').hidden = !enMarcha;
    id('draft-captains-block').hidden = Boolean(enMarcha);
    id('draft-admin-state').textContent = draft ? window.DraftView.draftLabel(draft.status) : '—';

    if (!enMarcha) return;
    id('pause-draft').hidden = draft.status !== 'ACTIVE';
    id('resume-draft').hidden = draft.status !== 'PAUSED';

    const turno = window.DraftView.currentTeam(draft);
    id('draft-live-turn').textContent = draft.status === 'COMPLETED'
      ? `${draft.totalPicks} elecciones · equipos completos`
      : `Ronda ${draft.round} · elección ${Math.min(draft.pick, draft.totalPicks)} de ${draft.totalPicks}${turno ? ` · ${turno.name}` : ''}`;

    id('draft-live-teams').replaceChildren(...(draft.teams || []).map((equipo) => {
      const card = document.createElement('article');
      if (turno?.id === equipo.id) card.classList.add('is-turn');
      const titulo = document.createElement('h4');
      titulo.textContent = equipo.name;
      const lista = document.createElement('ul');
      for (const miembro of window.DraftView.teamSlots(equipo, draft.teamSize)) {
        const fila = document.createElement('li');
        fila.textContent = miembro ? miembro.displayName : '—';
        if (miembro?.role === 'captain') fila.classList.add('captain');
        if (!miembro) fila.classList.add('empty');
        lista.append(fila);
      }
      card.append(titulo, lista);
      return card;
    }));
  }

  // -------------------------------------------------------------- datos

  async function cargar(eventoActual) {
    evento = eventoActual;
    if (!evento?.modules?.draft) { seccion().hidden = true; return; }
    seccion().hidden = false;

    const [participantes, estado] = await Promise.all([
      api(`/api/admin/events/${evento.id}/participants`).catch(() => ({ participants: [] })),
      api(`/api/admin/events/${evento.id}/draft`).catch(() => ({ draft: null, teams: [] }))
    ]);

    confirmados = (participantes.participants || [])
      .filter((persona) => persona.status === 'confirmed')
      .map((persona) => ({
        participantId: persona.id,
        displayName: persona.displayName,
        riotId: persona.riotId ?? null
      }));

    draft = estado.draft || { status: 'PENDING', teamCount: 4, teamSize: 5, totalPicks: 16 };
    equipos = estado.teams || [];

    const selectorEquipos = id('draft-team-count');
    if (estado.format) {
      numeroDeEquipos = estado.format.teams;
      selectorEquipos.value = String(numeroDeEquipos);
      selectorEquipos.disabled = true;
      selectorEquipos.title = 'El formato oficial fija cuatro equipos.';
    } else {
      selectorEquipos.disabled = false;
      selectorEquipos.removeAttribute('title');
    }

    // Si hay algo guardado manda eso; si no, lo que haya elegido en pantalla.
    if (estado.draft) numeroDeEquipos = draft.teamCount ?? numeroDeEquipos;
    if (capitanes.length !== numeroDeEquipos) {
      capitanes = Array.from({ length: numeroDeEquipos }, (_, i) => capitanes[i] ?? null);
    }
    // Si ya se guardaron, se recuperan en su orden.
    if (equipos.length) {
      capitanes = [...equipos].sort((a, b) => a.seed - b.seed).map((e) => e.captainParticipantId);
    }

    pintarFormato();
    pintarCapitanes();
    pintarEnCurso();
    conectar();
  }

  const refrescar = window.DraftView.createRefreshQueue(async () => {
    if (evento) await cargar(evento);
  });

  function conectar() {
    // Sólo se puede escuchar lo que ya es público; si el evento sigue anunciado
    // el canal no se abre y el panel se actualiza al recargar.
    if (stream || !evento || evento.status === 'Próximamente') return;
    stream = new EventSource(`/api/events/${encodeURIComponent(evento.slug)}/draft/stream`);
    for (const tipo of ['pick_made', 'draft_started', 'draft_paused', 'draft_resumed', 'draft_completed', 'team_updated']) {
      stream.addEventListener(tipo, () => refrescar());
    }
  }

  // ------------------------------------------------------------ acciones

  async function guardarCapitanes() {
    try {
      await api(`/api/admin/events/${evento.id}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          captains: capitanes,
          teamCount: numeroDeEquipos,
          teamSize: window.DraftView.TEAM_SIZE
        })
      });
      aviso('Capitanes guardados.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se han podido guardar.', true);
    }
  }

  async function iniciar() {
    if (!confirm('¿Iniciar el draft?\n\nComenzará la ronda 1 y el primer capitán podrá elegir.')) return;
    try {
      await api(`/api/admin/events/${evento.id}/draft/start`, { method: 'POST' });
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido iniciar.', true);
    }
  }

  async function cambiarEstado(status) {
    try {
      await api(`/api/admin/events/${evento.id}/draft/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido cambiar el estado.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    id('save-captains')?.addEventListener('click', guardarCapitanes);
    id('draft-team-count')?.addEventListener('change', (suceso) =>
      cambiarNumeroDeEquipos(suceso.target.value));
    id('start-draft')?.addEventListener('click', iniciar);
    id('pause-draft')?.addEventListener('click', () => cambiarEstado('PAUSED'));
    id('resume-draft')?.addEventListener('click', () => cambiarEstado('ACTIVE'));
  });

  // El panel de competición ya emite este aviso al elegir evento: se
  // reaprovecha en vez de inventar otro canal.
  window.addEventListener('jartiland:event-selected', (aviso) => {
    cargar(aviso.detail.event).catch((error) => avisoDeCarga(error));
  });

  function avisoDeCarga(error) {
    seccion().hidden = false;
    aviso(error?.message || 'No se ha podido cargar el draft.', true);
  }

  window.loadDraftAdmin = cargar;
})();
