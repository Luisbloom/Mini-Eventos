'use strict';

const elements = {
  dot: document.querySelector('#info-status-dot'),
  status: document.querySelector('#info-status'),
  intro: document.querySelector('#general-intro'),
  date: document.querySelector('#tournament-date'),
  time: document.querySelector('#tournament-time'),
  participants: document.querySelector('#participant-count'),
  tournamentStatus: document.querySelector('#tournament-status'),
  phase: document.querySelector('#current-phase'),
  classification: document.querySelector('#classification-format'),
  final: document.querySelector('#final-format'),
  groupsNote: document.querySelector('#groups-note'),
  scoring: document.querySelector('#scoring-cards'),
  rules: document.querySelector('#rules-list'),
  tiebreakers: document.querySelector('#tiebreakers-list'),
  faqs: document.querySelector('#faq-list'),
  schedule: document.querySelector('#info-schedule')
};

const eventSlug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || 'among-us-agosto-2026');

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function displayDate(value) {
  if (!value) return 'Por anunciar';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' })
    .format(new Date(year, month - 1, day));
}

function renderScoring(scoring) {
  const cards = scoring.rules.map((rule) => {
    const card = document.createElement('article');
    card.className = 'score-card';
    const label = document.createElement('span');
    label.textContent = rule.label;
    const points = document.createElement('strong');
    points.textContent = `${rule.points > 0 ? '+' : ''}${rule.points}`;
    card.append(label, points);
    if (rule.maximum !== undefined) {
      const maximum = document.createElement('small');
      maximum.textContent = `MÁXIMO +${rule.maximum} POR PARTIDA`;
      card.append(maximum);
    }
    return card;
  });
  elements.scoring.replaceChildren(...cards);

  const config = scoring.config;
  setText('#example-win-a', `+${config.impostorWin}`);
  setText('#example-kills-a', `+${config.kill * 2}`);
  setText('#example-total-a', config.impostorWin + (config.kill * 2));
  setText('#example-win-b', `+${config.impostorWin}`);
  setText('#example-total-b', config.impostorWin);
  setText('#early-win', `+${config.crewWin}`);
  setText('#early-tasks', `+${config.allTasks}`);
  setText('#early-total', config.crewWin + config.allTasks);
}

function renderList(target, items) {
  target.replaceChildren(...items.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function renderFaqs(faqs) {
  elements.faqs.replaceChildren(...faqs.map((faq, index) => {
    const details = document.createElement('details');
    if (index === 0) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = faq.question;
    const answer = document.createElement('p');
    answer.textContent = faq.answer;
    details.append(summary, answer);
    return details;
  }));
}


// La agenda es un módulo opcional: su sección sólo aparece cuando tiene datos.
function revealModule(name) {
  document.querySelectorAll(`[data-module="${name}"]`).forEach((element) => { element.hidden = false; });
}

async function loadSchedule(event) {
  if (!event?.modules?.schedule) return;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/schedule`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { schedule } = await response.json();
    if (!schedule?.length) return;
    elements.schedule.replaceChildren(...schedule.map((entry) => {
      const item = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = entry.time;
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const description = document.createElement('p');
      description.textContent = entry.description;
      item.append(time, title, description);
      return item;
    }));
    revealModule('schedule');
  } catch {
    // Complementario al manual: si falla, la sección se queda oculta y el resto se lee igual.
  }
}

/**
 * Todo lo que el formato oficial declara, explicado en la página.
 *
 * ⚠️ Cada texto declarado tiene que tener aquí su hueco. Un texto escrito,
 * revisado y que no pinta nadie es trabajo que no llega a existir para quien
 * viene a informarse: ya pasó con los mapas, las partidas y las pausas.
 */
const VALORANT_TEXTOS = Object.freeze({
  headline: '#valorant-info-headline',
  summary: '#valorant-info-summary',
  size: '#valorant-info-size',
  registration: '#valorant-info-registration',
  captains: '#valorant-info-captains',
  draft: '#valorant-info-draft',
  regularSeason: '#valorant-info-regular',
  standings: '#valorant-info-standings',
  tiebreakers: '#valorant-info-tiebreakers',
  playoffs: '#valorant-info-playoffs',
  grandFinal: '#valorant-info-grandfinal',
  thirdPlace: '#valorant-info-thirdplace',
  formats: '#valorant-info-formats',
  maps: '#valorant-info-maps',
  matches: '#valorant-info-matches',
  days: '#valorant-info-days',
  volume: '#valorant-info-volume',
  pauses: '#valorant-info-pauses',
  bans: '#valorant-info-bans',
  results: '#valorant-info-results',
  stats: '#valorant-info-stats'
});

/**
 * La tabla de «cuántos partidos». Los números llegan calculados del servidor.
 *
 * Un partido es una eliminatoria; los mapas son las partidas que se juegan
 * dentro. En la liga coinciden —BO1, un mapa— y en playoffs no, y confundirlos
 * es lo que hace que la gente crea que va a jugar tres veces y acabe jugando
 * doce.
 */
function renderValorantLoad(resumenes) {
  const cuerpo = document.querySelector('#valorant-load-body');
  if (!cuerpo) return;
  const bloque = cuerpo.closest('section');
  if (!Array.isArray(resumenes) || !resumenes.length) {
    if (bloque) bloque.hidden = true;
    return;
  }
  if (bloque) bloque.hidden = false;

  const celda = (texto, etiqueta) => {
    const td = document.createElement('td');
    td.textContent = texto;
    if (etiqueta) {
      const small = document.createElement('small');
      small.textContent = etiqueta;
      td.append(small);
    }
    return td;
  };

  cuerpo.replaceChildren(...resumenes.map((resumen) => {
    const fila = document.createElement('tr');
    const titulo = document.createElement('th');
    titulo.scope = 'row';
    titulo.textContent = `${resumen.players} jugadores`;
    const equipos = document.createElement('small');
    equipos.textContent = `${resumen.teams} equipos`;
    titulo.append(equipos);
    fila.append(
      titulo,
      celda(`${resumen.league.perTeam} partidos`, `${resumen.league.matchdays} jornadas · BO1`),
      celda(`${resumen.playoffs.perTeam.min} a ${resumen.playoffs.perTeam.max}`, 'eliminatorias · BO3'),
      celda(`${resumen.champion.undefeated.matches} u ${resumen.champion.throughLowerBracket.matches}`,
        `${resumen.champion.undefeated.maps.min}–${resumen.champion.throughLowerBracket.maps.max} mapas`)
    );
    return fila;
  }));

  // El caso que de verdad interesa, dicho con palabras y no sólo en la tabla.
  const veinte = resumenes[0];
  const nota = document.querySelector('#valorant-load-note');
  if (nota && veinte) {
    nota.textContent = `Con ${veinte.players} jugadores, el campeón juega ${veinte.champion.undefeated.matches} partidos si gana todos (${veinte.champion.undefeated.maps.min} a ${veinte.champion.undefeated.maps.max} mapas) u ${veinte.champion.throughLowerBracket.matches} si pierde una vez por el camino (${veinte.champion.throughLowerBracket.maps.min} a ${veinte.champion.throughLowerBracket.maps.max} mapas). La horquilla sale de que cada BO3 puede acabar 2-0 o 2-1.`;
  }
}

function renderValorantFormat(format) {
  const block = document.querySelector('#valorant-information');
  block.hidden = !format;
  if (!format) return;

  for (const [clave, selector] of Object.entries(VALORANT_TEXTOS)) {
    setText(selector, format.public[clave] ?? '');
  }

  // Lo vetado, en listas: se busca de un vistazo antes de jugar, no se lee.
  const lista = (selector, valores) => {
    const caja = document.querySelector(selector);
    if (!caja) return;
    caja.replaceChildren(...(valores || []).map((valor) => {
      const punto = document.createElement('li');
      punto.textContent = valor;
      return punto;
    }));
  };
  lista('#valorant-ban-weapons', format.bans?.weapons);
  lista('#valorant-ban-agents', format.bans?.agents);

  // El recorrido del participante, numerado: es lo que responde «¿y yo qué
  // tengo que hacer?» sin leerse el resto.
  const recorrido = document.querySelector('#valorant-info-journey');
  recorrido.replaceChildren(...(format.participantJourney || []).map((paso) => {
    const punto = document.createElement('li');
    punto.textContent = paso;
    return punto;
  }));

  /*
    Lo que aún no se sabe se enseña, en vez de callarlo. Quien lee esto quiere
    saber si ya hay fecha; que no aparezca la pregunta no la responde.
  */
  const pendientes = format.pending || [];
  document.querySelector('#valorant-pending-block').hidden = pendientes.length === 0;
  document.querySelector('#valorant-info-pending').replaceChildren(...pendientes.map((cosa) => {
    const punto = document.createElement('li');
    punto.textContent = cosa;
    return punto;
  }));
}

function render(data) {
  if (data.event) {
    document.title = `Información · ${data.event.name}`;
    document.documentElement.style.setProperty('--event-accent', data.event.accentColor);
    document.querySelector('#info-event-link').href = `/eventos/${encodeURIComponent(data.event.slug)}`;
    document.querySelector('#info-event-intro').textContent = `Todo lo que necesitas saber sobre ${data.event.name}.`;
  }
  document.querySelectorAll('[data-among-only]').forEach((element) => {
    element.hidden = !data.scoring;
  });
  const { general, format, rules, tiebreakers, faqs } = data.information;
  elements.intro.textContent = general.intro;
  elements.date.textContent = displayDate(general.date);
  elements.time.textContent = general.time || 'Por anunciar';
  elements.participants.textContent = general.participantCount ?? 'Por confirmar';
  elements.tournamentStatus.textContent = general.status;
  elements.phase.textContent = general.phase;
  elements.classification.textContent = format.classification;
  elements.final.textContent = format.final;
  elements.groupsNote.hidden = !format.groupsEnabled;
  if (data.scoring) renderScoring(data.scoring);
  renderList(elements.rules, rules);
  renderList(elements.tiebreakers, tiebreakers);
  renderFaqs(faqs);
  renderValorantFormat(data.event?.officialFormat);
  renderValorantLoad(data.matchSummaries);
  loadSchedule(data.event);
  elements.dot.className = 'live-dot live';
  elements.status.textContent = 'INFORMACIÓN OFICIAL';
}

async function loadInformation() {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(eventSlug)}/tournament-information`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch {
    elements.dot.className = 'live-dot error';
    elements.status.textContent = 'NO DISPONIBLE';
    elements.intro.textContent = 'No se ha podido cargar la información. Inténtalo de nuevo en unos instantes.';
  }
}

loadInformation();
