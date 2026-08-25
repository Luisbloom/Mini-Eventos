'use strict';

/**
 * Página pública de la fase regular: clasificación y calendario.
 *
 * Misma regla que el draft: el canal en directo **avisa**, no manda. Cuando
 * llega un aviso se vuelve a pedir el estado entero, porque la base de datos es
 * la única verdad y quien se pierda un aviso tiene que poder recuperarse.
 */

const byId = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

let estado = null;
let stream = null;

function conexion(clase, texto) {
  byId('league-dot').className = `live-dot ${clase}`;
  byId('league-connection').textContent = texto;
}

function noDisponible(titulo, copia) {
  byId('league-main').hidden = true;
  const caja = byId('league-unavailable');
  caja.hidden = false;
  byId('league-unavailable-title').textContent = titulo;
  byId('league-unavailable-copy').textContent = copia;
  conexion('error', 'NO DISPONIBLE');
}

const nombreDe = (equipo) => equipo?.name || `Equipo ${equipo?.teamId ?? '?'}`;

function nombreDeMapa(clave) {
  return (estado.maps || []).find((mapa) => mapa.key === clave)?.name || clave;
}

// ---------------------------------------------------- estadísticas

/** Cómo se llama cada participante, para las tablas de jugadores. */
let nombresDeJugador = new Map();
let equipoDeJugador = new Map();

function nombreDeJugador(participantId) {
  return nombresDeJugador.get(participantId) || `Jugador ${participantId}`;
}

/**
 * Sólo se pintan las columnas que alguien tiene. Diez columnas llenas de
 * guiones no informan: si ninguna captura traía ADR, esa columna sobra.
 */
function columnasConDatos(filas, candidatas) {
  return candidatas.filter(([campo]) =>
    filas.some((fila) => fila[campo] !== null && fila[campo] !== undefined));
}

function tablaDeEstadisticas(tabla, filas, columnas, { primera = 'JUGADOR', porEquipo = false } = {}) {
  const cabecera = document.createElement('thead');
  const filaCabecera = document.createElement('tr');
  for (const [, etiqueta, titulo] of [[null, primera, null], ...columnas]) {
    const celda = document.createElement('th');
    celda.scope = 'col';
    celda.textContent = etiqueta;
    if (titulo) { celda.title = titulo; celda.setAttribute('aria-label', titulo); }
    filaCabecera.append(celda);
  }
  cabecera.append(filaCabecera);

  const cuerpo = document.createElement('tbody');
  let equipoAnterior = null;
  for (const fila of filas) {
    // Una línea separa visualmente a los dos equipos.
    if (porEquipo && equipoAnterior !== null && fila.teamId !== equipoAnterior) {
      const separador = document.createElement('tr');
      separador.className = 'team-split';
      separador.append(document.createElement('td'));
      separador.firstChild.colSpan = columnas.length + 1;
      cuerpo.append(separador);
    }
    equipoAnterior = fila.teamId;

    const tr = document.createElement('tr');
    const quien = document.createElement('th');
    quien.scope = 'row';
    quien.textContent = nombreDeJugador(fila.participantId);
    if (fila.agent || fila.topAgent) {
      const agente = document.createElement('small');
      agente.textContent = fila.agent || fila.topAgent;
      quien.append(agente);
    }
    tr.append(quien);

    for (const [campo] of columnas) {
      const celda = document.createElement('td');
      const valor = fila[campo];
      // Un dato que no se vio se enseña como raya, no como cero.
      celda.textContent = valor === null || valor === undefined ? '—' : String(valor);
      if (valor === null || valor === undefined) celda.classList.add('is-missing');
      tr.append(celda);
    }
    cuerpo.append(tr);
  }

  tabla.replaceChildren(cabecera, cuerpo);
}

const COLUMNAS_PARTIDA = [
  ['acs', 'ACS', 'Puntuación media de combate'],
  ['kills', 'K', 'Bajas'], ['deaths', 'D', 'Muertes'], ['assists', 'A', 'Asistencias'],
  ['plusMinus', '+/-', 'Diferencia entre bajas y muertes'],
  ['adr', 'ADR', 'Daño medio por ronda'],
  ['hsPercent', 'HS%', 'Porcentaje de disparos a la cabeza'],
  ['kastPercent', 'KAST', 'Rondas con baja, asistencia, supervivencia o intercambio'],
  ['firstKills', 'FK', 'Primeras bajas'], ['firstDeaths', 'FD', 'Primeras muertes']
];

const COLUMNAS_TORNEO = [
  ['games', 'PJ', 'Partidas jugadas'],
  ['kills', 'K', 'Bajas'], ['deaths', 'D', 'Muertes'], ['assists', 'A', 'Asistencias'],
  ['kd', 'K/D', 'Bajas entre muertes'],
  ['acs', 'ACS', 'Puntuación media de combate'],
  ['adr', 'ADR', 'Daño medio por ronda'],
  ['hsPercent', 'HS%', 'Porcentaje de disparos a la cabeza'],
  ['kastPercent', 'KAST', 'Rondas con baja, asistencia, supervivencia o intercambio'],
  ['firstKills', 'FK', 'Primeras bajas'], ['firstDeaths', 'FD', 'Primeras muertes']
];

function abrirEstadisticasDePartida(serie, juego) {
  byId('match-stats-title').textContent =
    `${nombreDe(serie.teamA)} vs ${nombreDe(serie.teamB)}`;
  byId('match-stats-score').textContent =
    `${juego.teamARounds}–${juego.teamBRounds} · ${nombreDeMapa(juego.mapKey)}`;

  // Los del equipo local primero, y dentro de cada uno por ACS.
  const filas = [...juego.stats].sort((uno, otro) => {
    if (uno.teamId !== otro.teamId) return uno.teamId === serie.teamA.teamId ? -1 : 1;
    return (otro.acs ?? -1) - (uno.acs ?? -1);
  });

  tablaDeEstadisticas(byId('match-stats-table'), filas,
    columnasConDatos(filas, COLUMNAS_PARTIDA), { porEquipo: true });
  byId('match-stats-dialog').showModal();
}

function pintarJugadores() {
  const filas = estado.playerStats || [];
  const seccion = byId('players-section');
  seccion.hidden = filas.length === 0;
  if (!filas.length) return;

  const columnas = columnasConDatos(filas, COLUMNAS_TORNEO);
  tablaDeEstadisticas(byId('public-players'), filas, columnas);

  // Las medias sólo cuentan las partidas donde ese dato estaba: decirlo evita
  // comparar un ADR de cinco partidas con otro de una.
  const conMedia = filas.filter((fila) => fila.adr !== null).length;
  byId('players-note').textContent = conMedia && conMedia < filas.length
    ? 'Las medias sólo cuentan las partidas en las que ese dato aparecía en la captura.'
    : 'Los promedios se calculan sólo sobre las partidas con ese dato disponible.';
}

// ------------------------------------------------------------ clasificación

const COLUMNAS = [
  ['POS', 'Posición'], ['EQUIPO', 'Equipo'], ['PJ', 'Partidos jugados'],
  ['V', 'Victorias'], ['D', 'Derrotas'], ['RF', 'Rondas a favor'],
  ['RC', 'Rondas en contra'], ['DIF', 'Diferencia de rondas']
];

function pintarClasificacion() {
  const cabecera = document.createElement('thead');
  const fila = document.createElement('tr');
  for (const [corto, largo] of COLUMNAS) {
    const celda = document.createElement('th');
    celda.scope = 'col';
    celda.textContent = corto;
    celda.title = largo;                 // las abreviaturas no se adivinan
    celda.setAttribute('aria-label', largo);
    fila.append(celda);
  }
  cabecera.append(fila);

  let hayEmpateSinResolver = false;
  const cuerpo = document.createElement('tbody');
  for (const equipo of estado.standings || []) {
    const tr = document.createElement('tr');
    if (equipo.qualified) tr.classList.add('is-qualified');
    if (equipo.tieRequiresAdmin) { tr.classList.add('needs-admin'); hayEmpateSinResolver = true; }

    const valores = [
      equipo.position, nombreDe(equipo), equipo.played, equipo.wins, equipo.losses,
      equipo.roundsFor, equipo.roundsAgainst,
      equipo.roundDiff > 0 ? `+${equipo.roundDiff}` : String(equipo.roundDiff)
    ];
    valores.forEach((valor, indice) => {
      const celda = document.createElement(indice === 1 ? 'th' : 'td');
      if (indice === 1) celda.scope = 'row';
      celda.textContent = String(valor);
      tr.append(celda);
    });
    cuerpo.append(tr);
  }

  byId('public-standings').replaceChildren(cabecera, cuerpo);

  // Un empate que ningún criterio deshace lo resuelve la organización. Se dice,
  // en vez de inventar un orden y que parezca decidido.
  const nota = byId('league-tie-note');
  nota.hidden = !hayEmpateSinResolver;
  nota.textContent = 'Hay un empate que ningún criterio deshace: lo resolverá la organización.';
}

// -------------------------------------------------------------- calendario

function filaDeSerie(serie) {
  const fila = document.createElement('li');
  if (serie.status === 'COMPLETED') fila.classList.add('is-done');

  const local = document.createElement('span');
  local.textContent = nombreDe(serie.teamA);
  if (serie.winnerTeamId === serie.teamA.teamId) local.classList.add('is-winner');

  const jugadas = serie.games.filter((juego) => juego.status === 'COMPLETED');
  const marcador = document.createElement('b');
  marcador.textContent = jugadas.length
    ? jugadas.map((juego) => `${juego.teamARounds}–${juego.teamBRounds}`).join(' · ')
    : 'vs';

  const visitante = document.createElement('span');
  visitante.textContent = nombreDe(serie.teamB);
  if (serie.winnerTeamId === serie.teamB.teamId) visitante.classList.add('is-winner');

  fila.append(local, marcador, visitante);

  const mapas = serie.games.map((juego) => juego.mapKey).filter(Boolean);
  if (mapas.length) {
    const mapa = document.createElement('small');
    mapa.textContent = mapas.map(nombreDeMapa).join(' · ');
    fila.append(mapa);
  }

  // Si hay estadísticas confirmadas se pueden abrir; si no, ni se ofrece.
  const conStats = serie.games.filter((juego) => (juego.stats || []).length);
  if (conStats.length) {
    const ver = document.createElement('button');
    ver.type = 'button';
    ver.className = 'match-stats-link';
    ver.textContent = 'VER ESTADÍSTICAS';
    ver.addEventListener('click', () => abrirEstadisticasDePartida(serie, conStats[0]));
    fila.append(ver);
  }
  return fila;
}

function pintarCalendario() {
  byId('public-matchdays').replaceChildren(...(estado.matchdays || []).map((jornada) => {
    const bloque = document.createElement('article');
    bloque.className = 'public-matchday';

    const titulo = document.createElement('h3');
    titulo.textContent = `Jornada ${jornada.matchday}`;
    bloque.append(titulo);

    // Con cinco equipos siempre hay uno que descansa: se dice, para que nadie
    // busque un partido que no existe.
    if (jornada.bye) {
      const descansa = document.createElement('p');
      descansa.className = 'public-bye';
      descansa.textContent = `Descansa ${nombreDe(jornada.bye)}`;
      bloque.append(descansa);
    }

    const lista = document.createElement('ul');
    lista.append(...jornada.series.map(filaDeSerie));
    bloque.append(lista);
    return bloque;
  }));
}

// ------------------------------------------------------------------ pintar

function pintar() {
  byId('league-main').hidden = false;
  byId('league-unavailable').hidden = true;
  byId('back-to-event').href = `/eventos/${encodeURIComponent(slug)}`;
  byId('back-to-draft').href = `/eventos/${encodeURIComponent(slug)}/draft`;

  byId('league-matchday-count').textContent = String((estado.matchdays || []).length);
  byId('league-played').textContent = `${estado.seriesPlayed} / ${estado.seriesTotal}`;
  byId('league-qualifiers').textContent = String(estado.qualifiers ?? 4);
  byId('league-headline').textContent = estado.complete
    ? 'Fase regular terminada.'
    : `Quedan ${estado.seriesTotal - estado.seriesPlayed} partidos por jugar.`;

  // Los nombres de los jugadores salen de los equipos, que ya vienen con el
  // estado público: nada de pedir datos personales aparte.
  nombresDeJugador = new Map();
  equipoDeJugador = new Map();
  for (const equipo of estado.teams || []) {
    for (const miembro of equipo.members || []) {
      nombresDeJugador.set(miembro.participantId, miembro.displayName);
      equipoDeJugador.set(miembro.participantId, equipo.name);
    }
  }

  pintarClasificacion();
  pintarCalendario();
  pintarJugadores();
}

async function pedirEstado() {
  const respuesta = await fetch(
    `/api/events/${encodeURIComponent(slug)}/competition-teams`, { cache: 'no-store' });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    const code = cuerpo?.error?.code;
    noDisponible(
      code === 'EVENT_NOT_PUBLISHED' ? 'Todavía no' : 'Sin competición',
      code === 'EVENT_NOT_PUBLISHED'
        ? 'Este torneo aún no está abierto. Cuando lo esté, la fase regular se verá aquí.'
        : 'Este evento no juega una fase regular por equipos.');
    return false;
  }

  estado = await respuesta.json();
  if (!estado.generated) {
    noDisponible('Todavía no',
      'El calendario se publica cuando termine el draft y estén los equipos.');
    return true;   // el evento existe: merece la pena escuchar el canal
  }

  pintar();
  conexion('live', estado.complete ? 'TERMINADA' : 'EN DIRECTO');
  return true;
}

const refrescar = window.DraftView.createRefreshQueue(async () => {
  try { await pedirEstado(); }
  catch { conexion('error', 'SIN CONEXIÓN'); }
});

function conectar() {
  if (stream) stream.close();
  stream = new EventSource(`/api/events/${encodeURIComponent(slug)}/draft/stream`);
  // Ningún aviso trae datos que se apliquen: todos disparan lo mismo.
  for (const tipo of ['connected', 'competition_updated', 'draft_completed', 'team_updated']) {
    stream.addEventListener(tipo, () => { refrescar(); });
  }
  stream.addEventListener('error', () => conexion('loading', 'RECONECTANDO'));
}

byId('match-stats-close')?.addEventListener('click', () => byId('match-stats-dialog').close());

window.addEventListener('pagehide', () => { if (stream) stream.close(); });

(async () => {
  if (await pedirEstado()) conectar();
})();
