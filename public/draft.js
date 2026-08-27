'use strict';

/**
 * Página del draft. Todo lo que decide qué se enseña vive en draft-view.js, que
 * se prueba en Node; aquí sólo queda pintar y hablar con el servidor.
 *
 * Regla que sostiene la pantalla: el canal en directo **avisa**, no manda.
 * Cuando llega un aviso se vuelve a pedir el estado, porque la base de datos es
 * la única verdad y quien se pierda un aviso tiene que poder recuperarse.
 */

const V = () => window.DraftView;
const byId = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

let draft = null;
let me = { authenticated: false };
let stream = null;
let seleccionado = null;

function setConnection(estado, texto) {
  byId('draft-dot').className = `live-dot ${estado}`;
  byId('draft-connection').textContent = texto;
}

function mostrarNoDisponible(titulo, copia, upcoming = false) {
  byId('draft-main').hidden = true;
  byId('draft-preview').hidden = true;
  const caja = byId('draft-unavailable');
  caja.hidden = false;
  byId('draft-unavailable-title').textContent = titulo;
  byId('draft-unavailable-copy').textContent = copia;
  setConnection(upcoming ? 'loading' : 'error', upcoming ? 'PRÓXIMAMENTE' : 'NO DISPONIBLE');
}

function configurarNavegacion() {
  byId('back-to-event').href = `/eventos/${encodeURIComponent(slug)}`;
  const competition = `/eventos/${encodeURIComponent(slug)}/competicion`;
  byId('back-to-competition').href = competition;
  byId('draft-nav-hub').href = competition;
  byId('draft-nav-draft').href = `${competition}/draft`;
  byId('draft-nav-regular').href = `${competition}/fase-regular`;
  byId('draft-nav-playoffs').href = `${competition}/playoffs`;
  byId('draft-nav-stats').href = `${competition}/estadisticas`;
  byId('draft-nav-results').href = `${competition}/resultados`;
}

function mostrarPrevia(event) {
  const format = event.officialFormat;
  configurarNavegacion();
  byId('draft-main').hidden = true;
  byId('draft-unavailable').hidden = true;
  byId('draft-preview').hidden = false;
  document.title = `Draft · ${event.name} · Mini Eventos Jartiland`;
  document.documentElement.style.setProperty('--event-accent', event.accentColor || '#ff4655');
  const kpis = [
    ['JUGADORES', format.players], ['CAPITANES', format.captains],
    ['ELECCIONES', format.draftPicks], ['EQUIPOS FINALES', `${format.teams} × ${format.teamSize}`]
  ];
  byId('draft-preview-kpis').replaceChildren(...kpis.map(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = String(value);
    item.append(term, detail); return item;
  }));
  byId('draft-preview-captains').replaceChildren(...Array.from({ length: format.captains }, (_, index) => {
    const card = document.createElement('article');
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('strong'); title.textContent = 'Capitán';
    const state = document.createElement('small'); state.textContent = 'POR ANUNCIAR';
    card.append(number, title, state); return card;
  }));
  byId('draft-preview-rounds').replaceChildren(...Array.from({ length: format.draftRounds }, (_, index) => {
    const card = document.createElement('article');
    const number = document.createElement('span'); number.textContent = `RONDA ${index + 1}`;
    const copy = document.createElement('strong'); copy.textContent = `${format.teams} elecciones`;
    const state = document.createElement('small'); state.textContent = 'ORDEN POR ANUNCIAR';
    card.append(number, copy, state); return card;
  }));
  setConnection('loading', 'PRÓXIMAMENTE');
}

// ------------------------------------------------------------------ pintar

function pintarCabecera() {
  byId('draft-status').textContent = V().draftLabel(draft.status);
  byId('draft-round').textContent = draft.status === 'PENDING' ? '—' : draft.round;
  byId('draft-pick').textContent = draft.status === 'PENDING'
    ? `0 / ${draft.totalPicks}`
    : `${Math.min(draft.pick, draft.totalPicks)} / ${draft.totalPicks}`;
  byId('draft-headline').textContent = V().draftHeadline(draft);

  const turno = V().currentTeam(draft);
  const caja = byId('draft-turn');
  caja.hidden = !turno;
  if (turno) {
    byId('draft-turn-team').textContent = turno.name;
    const capitan = turno.members.find((m) => m.role === 'captain');
    byId('draft-turn-captain').textContent = capitan ? `Capitán: ${capitan.displayName}` : '';
  }
}

function tarjetaEquipo(team) {
  const card = document.createElement('article');
  card.className = 'team-card';
  if (V().currentTeam(draft)?.id === team.id) card.classList.add('is-turn');

  const nombre = document.createElement('h3');
  nombre.textContent = team.name;

  const lista = document.createElement('ol');
  lista.className = 'team-roster';
  for (const miembro of V().teamSlots(team, draft.teamSize)) {
    const fila = document.createElement('li');
    if (!miembro) {
      fila.className = 'empty';
      fila.textContent = '—';
    } else {
      const quien = document.createElement('span');
      quien.textContent = miembro.displayName;
      fila.append(quien);
      if (miembro.role === 'captain') {
        const marca = document.createElement('b');
        marca.textContent = 'CAPITÁN';
        fila.append(marca);
      }
    }
    lista.append(fila);
  }

  card.append(nombre, lista);
  return card;
}

const NUMEROS = { 4: 'cuatro', 5: 'cinco', 6: 'seis' };

function pintarEquipos() {
  const equipos = draft.teams || [];
  const cuantos = draft.teamCount || equipos.length || 4;

  // El torneo se juega con cuatro, cinco o seis equipos, así que ni el título
  // ni la rejilla pueden dar por hecho que son cuatro.
  byId('teams-title').textContent = NUMEROS[cuantos]
    ? `Los ${NUMEROS[cuantos]} equipos`
    : 'Los equipos';

  // Seis en una fila salen demasiado estrechos; en dos filas de tres se leen.
  const zona = byId('draft-teams');
  zona.style.setProperty('--team-columns', String(cuantos === 6 ? 3 : cuantos));
  zona.replaceChildren(...equipos.map(tarjetaEquipo));
}

function pintarDisponibles() {
  const puedeElegir = V().canPick(draft, me);
  const zona = byId('draft-available');
  byId('available-count').textContent = `${draft.available.length} POR ELEGIR`;

  const pista = byId('captain-hint');
  const papel = V().viewerRole(draft, me);
  if (papel === 'captain' && draft.status === 'ACTIVE' && !puedeElegir) {
    const turno = V().currentTeam(draft);
    pista.hidden = false;
    pista.textContent = turno ? `Esperando a que elija ${turno.name}.` : 'Esperando turno.';
  } else if (puedeElegir) {
    pista.hidden = false;
    pista.textContent = 'Es tu turno: elige a un jugador para tu equipo.';
  } else {
    pista.hidden = true;
  }

  zona.replaceChildren(...draft.available.map((persona) => {
    const card = document.createElement('article');
    card.className = 'player-card';
    const nombre = document.createElement('strong');
    nombre.textContent = persona.displayName;
    card.append(nombre);

    if (puedeElegir) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = 'ELEGIR';
      boton.addEventListener('click', () => abrirModal(persona));
      card.append(boton);
    }
    return card;
  }));
}

function pintarHistorial() {
  byId('draft-history').replaceChildren(...(draft.picks || []).map((pick) => {
    const fila = document.createElement('li');
    const numero = document.createElement('span');
    numero.textContent = `#${pick.pickNumber}`;
    const equipo = document.createElement('strong');
    equipo.textContent = pick.teamName;
    const quien = document.createElement('b');
    quien.textContent = pick.displayName;
    fila.append(numero, equipo, quien);
    return fila;
  }));
}

function pintarNombreDeEquipo() {
  const caja = byId('team-name-section');
  const esCapitan = V().viewerRole(draft, me) === 'captain';
  // Se abre al terminar: durante el draft cada uno está a lo suyo.
  const visible = esCapitan && draft.status === 'COMPLETED';
  caja.hidden = !visible;
  if (!visible) return;

  const mio = draft.teams.find((team) => team.captainParticipantId === me.event.participantId);
  if (mio && document.activeElement !== byId('team-name')) byId('team-name').value = mio.name;
}

function pintar() {
  byId('draft-main').hidden = false;
  byId('draft-unavailable').hidden = true;
  pintarCabecera();
  pintarEquipos();
  pintarDisponibles();
  pintarHistorial();
  pintarNombreDeEquipo();
}

// ------------------------------------------------------------------ datos

async function pedirEstado() {
  const eventResponse = await fetch(`/api/events/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (eventResponse.ok) {
    const eventBody = await eventResponse.json();
    if (eventBody.event?.status === 'Próximamente') {
      if (eventBody.event.officialFormat) {
        mostrarPrevia(eventBody.event);
        return false;
      }
      mostrarNoDisponible('Todavía no',
        'Este torneo aún no ha comenzado. Cuando lo haga, el draft se verá aquí en directo.', true);
      return false;
    }
  }

  const [estado, yo] = await Promise.all([
    fetch(`/api/events/${encodeURIComponent(slug)}/draft`, { cache: 'no-store' }),
    fetch(`/api/me?event=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then((r) => r.json()).catch(() => ({ authenticated: false }))
  ]);

  if (!estado.ok) {
    const cuerpo = await estado.json().catch(() => ({}));
    const code = cuerpo?.error?.code;
    mostrarNoDisponible(
      code === 'EVENT_NOT_PUBLISHED' ? 'Todavía no' : 'Sin draft',
      code === 'EVENT_NOT_PUBLISHED'
        ? 'Este torneo aún no está abierto. Cuando lo esté, el draft se verá aquí en directo.'
        : 'Este evento no utiliza draft por equipos.',
      code === 'EVENT_NOT_PUBLISHED');
    return false;
  }

  draft = await estado.json();
  me = yo;
  configurarNavegacion();
  pintar();
  setConnection('live', draft.status === 'ACTIVE' ? 'EN DIRECTO' : 'CONECTADO');
  return true;
}

// Junta los avisos: si llegan tres seguidos no se lanzan tres peticiones.
const refrescar = window.DraftView.createRefreshQueue(async () => {
  try { await pedirEstado(); }
  catch { setConnection('error', 'SIN CONEXIÓN'); }
});

// ------------------------------------------------------------------ elegir

function abrirModal(persona) {
  seleccionado = persona;
  byId('pick-dialog-title').textContent = `¿Elegir a ${persona.displayName}?`;
  byId('pick-dialog-detail').textContent = `Elección #${draft.pick} · Ronda ${draft.round}`;
  byId('pick-dialog-feedback').textContent = '';
  byId('pick-confirm').disabled = false;
  byId('pick-dialog').showModal();
}

async function confirmarEleccion() {
  if (!seleccionado) return;
  const boton = byId('pick-confirm');
  const aviso = byId('pick-dialog-feedback');
  boton.disabled = true;

  try {
    const respuesta = await fetch(`/api/events/${encodeURIComponent(slug)}/draft/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sólo a quién eliges: quién eres y si te toca lo decide el servidor.
      body: JSON.stringify({ selectedParticipantId: seleccionado.participantId })
    });

    if (respuesta.status === 409 || respuesta.status === 403) {
      byId('pick-dialog').close();
      await refrescar();
      byId('draft-headline').textContent = 'El draft ha cambiado. Estado actualizado.';
      return;
    }
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => ({}));
      aviso.textContent = cuerpo?.error?.message || 'No se ha podido registrar la elección.';
      boton.disabled = false;
      return;
    }

    byId('pick-dialog').close();
    await refrescar();
  } catch {
    aviso.textContent = 'No se ha podido conectar. Inténtalo otra vez.';
    boton.disabled = false;
  }
}

// ------------------------------------------------------------- en directo

const AVISOS = [
  'connected', 'draft_configured', 'draft_started', 'pick_made',
  'draft_paused', 'draft_resumed', 'draft_completed', 'team_updated'
];

function conectar() {
  if (stream) stream.close();
  stream = new EventSource(`/api/events/${encodeURIComponent(slug)}/draft/stream`);

  for (const tipo of AVISOS) {
    // Ningún aviso trae datos que se apliquen: todos disparan lo mismo.
    stream.addEventListener(tipo, () => { refrescar(); });
  }

  stream.addEventListener('error', () => {
    // EventSource reintenta solo. No se borra lo que ya se ve.
    setConnection('loading', 'RECONECTANDO');
  });
}

// ------------------------------------------------------------------ arranque

byId('pick-dialog').addEventListener('close', () => {
  if (byId('pick-dialog').returnValue === 'confirm') confirmarEleccion();
});

byId('team-name-form').addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const aviso = byId('team-name-feedback');
  const boton = byId('team-name-form').querySelector('button');
  boton.disabled = true;
  aviso.textContent = '';
  try {
    const respuesta = await fetch(`/api/events/${encodeURIComponent(slug)}/my-team`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: byId('team-name').value })
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      aviso.textContent = cuerpo?.error?.message || 'No se ha podido guardar el nombre.';
    } else {
      aviso.textContent = 'Nombre guardado.';
      await refrescar();
    }
  } catch {
    aviso.textContent = 'No se ha podido conectar.';
  }
  boton.disabled = false;
});

window.addEventListener('pagehide', () => { if (stream) stream.close(); });

(async () => {
  if (await pedirEstado()) conectar();
})();
