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
  schedule: document.querySelector('#info-schedule'),
  prizes: document.querySelector('#info-prizes')
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


// La agenda y los premios son módulos opcionales del evento: sus secciones nacen
// ocultas y sólo se muestran si el evento los publica y traen algo que enseñar.
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

async function loadPrizes(event) {
  if (!event?.modules?.prizes) return;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/prizes`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { prizes } = await response.json();
    if (!prizes?.length) return;
    elements.prizes.replaceChildren(...prizes.map((prize, index) => {
      const card = document.createElement('article');
      const tag = document.createElement('span');
      tag.textContent = `PREMIO ${String(index + 1).padStart(2, '0')}`;
      const title = document.createElement('h3');
      title.textContent = prize.title;
      const description = document.createElement('p');
      description.textContent = prize.description;
      const value = document.createElement('b');
      value.textContent = prize.prizeValue || '';
      card.append(tag, title, description, value);
      return card;
    }));
    revealModule('prizes');
  } catch {
    // Idem: los premios oficiales están también en la página del evento.
  }
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
  loadSchedule(data.event);
  loadPrizes(data.event);
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
