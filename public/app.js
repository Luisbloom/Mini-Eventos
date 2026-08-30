'use strict';

const grid = document.querySelector('#event-grid');
const loading = document.querySelector('#events-loading');
const empty = document.querySelector('#events-empty');
const errorPanel = document.querySelector('#events-error');
const count = document.querySelector('#event-count');
const historyBoard = document.querySelector('#historial');
const historyList = document.querySelector('#history-list');
const historyCount = document.querySelector('#history-count');
const dot = document.querySelector('#portal-dot');
const state = document.querySelector('#portal-state');

function displayDate(value) {
  if (!value) return 'FECHA POR ANUNCIAR';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'FECHA POR ANUNCIAR';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date).replace('.', '').toUpperCase();
}

function createMeta(label, value, className = '') {
  const wrapper = document.createElement('div');
  if (className) wrapper.className = className;
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  return wrapper;
}

function safeStatusClass(event) {
  const code = event.registration?.code || event.status || 'event';
  return String(code).toLowerCase().replaceAll('_', '-').replace(/[^a-z0-9-]/g, '');
}

function coverFor(event, className, eager = false) {
  const cover = document.createElement('img');
  cover.className = className;
  cover.src = event.coverImage || '/images/events/default-event-cover.jpg';
  cover.alt = className === 'event-cover' ? `Portada de ${event.name}` : '';
  cover.loading = eager ? 'eager' : 'lazy';
  cover.addEventListener('error', () => {
    cover.src = '/images/events/default-event-cover.jpg';
  }, { once: true });
  return cover;
}

function createEventCard(event, index) {
  const article = document.createElement('article');
  article.className = 'event-card event-card-featured';
  if (event.accentColor) article.style.setProperty('--event-accent', event.accentColor);
  article.style.setProperty('--card-delay', `${index * 80}ms`);

  const visual = document.createElement('div');
  visual.className = 'event-visual';
  const sequence = document.createElement('span');
  sequence.className = 'event-sequence';
  sequence.textContent = 'EN CARTEL';
  const game = document.createElement('span');
  game.className = 'event-game';
  game.textContent = event.game;
  visual.append(coverFor(event, 'event-cover', index === 0), sequence, game);

  const content = document.createElement('div');
  content.className = 'event-card-content';
  const status = document.createElement('span');
  status.className = `event-status status-${safeStatusClass(event)}`;
  status.textContent = event.status;
  const title = document.createElement('h3');
  title.textContent = event.name;
  const description = document.createElement('p');
  description.textContent = event.description || 'Consulta todos los detalles del evento.';

  const meta = document.createElement('dl');
  meta.className = 'event-meta';
  const participantCount = Number(event.participantCount || 0);
  const minimum = event.minParticipants
    ? `${event.minParticipants} PERSONAS · ${participantCount >= event.minParticipants ? 'ALCANZADO' : `FALTAN ${event.minParticipants - participantCount}`}`
    : 'POR DEFINIR';
  meta.append(
    createMeta('FECHA', displayDate(event.startsAt)),
    createMeta('INSCRITOS', event.maxParticipants ? `${participantCount} / ${event.maxParticipants}` : String(participantCount)),
    createMeta('MÍNIMO PARA REALIZARSE', minimum, 'minimum-meta'),
    createMeta('INSCRIPCIÓN', String(event.registration?.label || event.status).toUpperCase(), 'registration-meta')
  );

  const link = document.createElement('a');
  link.className = 'event-link';
  link.href = window.PortalView.eventHref(event);
  link.innerHTML = 'ENTRAR AL EVENTO <span aria-hidden="true">↗</span>';
  content.append(status, title, description, meta, link);
  article.append(visual, content);
  return article;
}

function createHistoryItem(event) {
  const article = document.createElement('article');
  article.className = 'history-item';
  if (event.accentColor) article.style.setProperty('--event-accent', event.accentColor);

  const copy = document.createElement('div');
  copy.className = 'history-copy';
  const eyebrow = document.createElement('p');
  eyebrow.textContent = `${event.game} · ${displayDate(event.startsAt)}`;
  const title = document.createElement('h3');
  title.textContent = event.name;
  const summary = document.createElement('p');
  summary.textContent = `${event.participantCount || 0} participantes · Evento finalizado`;
  copy.append(eyebrow, title, summary);

  const link = document.createElement('a');
  link.className = 'history-link';
  link.href = window.PortalView.eventHref(event);
  link.innerHTML = 'VER RESULTADOS <span aria-hidden="true">→</span>';

  article.append(coverFor(event, 'history-cover'), copy, link);
  return article;
}

async function loadEvents() {
  loading.hidden = false;
  empty.hidden = true;
  errorPanel.hidden = true;
  grid.hidden = true;
  historyBoard.hidden = true;
  try {
    const response = await fetch('/api/events', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { events } = await response.json();
    const sections = window.PortalView.splitEvents(events);

    count.textContent = `${String(sections.current.length).padStart(2, '0')} ${sections.current.length === 1 ? 'EVENTO ACTIVO' : 'EVENTOS ACTIVOS'}`;
    loading.hidden = true;
    if (!sections.current.length) {
      empty.hidden = false;
    } else {
      grid.replaceChildren(...sections.current.map(createEventCard));
      grid.hidden = false;
    }

    historyList.replaceChildren(...sections.history.map(createHistoryItem));
    historyCount.textContent = `${String(sections.history.length).padStart(2, '0')} FINALIZADO${sections.history.length === 1 ? '' : 'S'}`;
    historyBoard.hidden = sections.history.length === 0;
    dot.className = 'live-dot live';
    state.textContent = 'CARTELERA ONLINE';
  } catch {
    loading.hidden = true;
    errorPanel.hidden = false;
    dot.className = 'live-dot error';
    state.textContent = 'SIN CONEXIÓN';
  }
}

document.querySelector('#retry-events').addEventListener('click', loadEvents);
loadEvents();
