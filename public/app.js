'use strict';

const grid = document.querySelector('#event-grid');
const loading = document.querySelector('#events-loading');
const empty = document.querySelector('#events-empty');
const errorPanel = document.querySelector('#events-error');
const count = document.querySelector('#event-count');
const dot = document.querySelector('#portal-dot');
const state = document.querySelector('#portal-state');

function displayDate(value) {
  if (!value) return 'FECHA POR ANUNCIAR';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'FECHA POR ANUNCIAR';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '').toUpperCase();
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

function createEventCard(event, index) {
  const article = document.createElement('article');
  article.className = 'event-card';
  article.style.setProperty('--event-accent', event.accentColor);
  article.style.setProperty('--card-delay', `${index * 80}ms`);
  const visual = document.createElement('div');
  visual.className = 'event-visual';
  const cover = document.createElement('img');
  cover.className = 'event-cover';
  cover.src = event.coverImage || '/images/events/default-event-cover.png';
  cover.alt = `Portada de ${event.name}`;
  cover.loading = index === 0 ? 'eager' : 'lazy';
  cover.addEventListener('error', () => { cover.src = '/images/events/default-event-cover.png'; }, { once: true });
  const sequence = document.createElement('span');
  sequence.className = 'event-sequence';
  sequence.textContent = String(index + 1).padStart(2, '0');
  const game = document.createElement('span');
  game.className = 'event-game';
  game.textContent = event.game;
  visual.append(cover, sequence, game);
  const content = document.createElement('div');
  content.className = 'event-card-content';
  const status = document.createElement('span');
  status.className = `event-status status-${event.registration.code.toLowerCase().replaceAll('_', '-')}`;
  status.textContent = event.status;
  const title = document.createElement('h3');
  title.textContent = event.name;
  const description = document.createElement('p');
  description.textContent = event.description || 'Consulta todos los detalles del evento.';
  const meta = document.createElement('dl');
  meta.className = 'event-meta';
  const minimum = event.minParticipants
    ? `${event.minParticipants} PERSONAS · ${event.participantCount >= event.minParticipants ? 'ALCANZADO' : `FALTAN ${event.minParticipants - event.participantCount}`}`
    : 'POR DEFINIR';
  meta.append(
    createMeta('FECHA', displayDate(event.startsAt)),
    createMeta('INSCRITOS', event.maxParticipants ? `${event.participantCount} / ${event.maxParticipants}` : String(event.participantCount)),
    createMeta('MÍNIMO PARA REALIZARSE', minimum, 'minimum-meta'),
    createMeta('INSCRIPCIÓN', event.registration.label.toUpperCase(), 'registration-meta')
  );
  // El estado y la apertura de inscripciones son informativos: no ocultan una
  // ficha que ya está publicada en la cartelera.
  const link = document.createElement('a');
  link.className = 'event-link';
  link.href = window.PortalView.eventHref(event);
  link.innerHTML = 'VER EVENTO <span aria-hidden="true">↗</span>';
  content.append(status, title, description, meta, link);
  article.append(visual, content);
  return article;
}

async function loadEvents() {
  loading.hidden = false;
  empty.hidden = true;
  errorPanel.hidden = true;
  grid.hidden = true;
  try {
    const response = await fetch('/api/events', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { events } = await response.json();
    count.textContent = `${String(events.length).padStart(2, '0')} ${events.length === 1 ? 'EVENTO' : 'EVENTOS'}`;
    loading.hidden = true;
    if (!events.length) empty.hidden = false;
    else {
      grid.replaceChildren(...events.map(createEventCard));
      grid.hidden = false;
    }
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
