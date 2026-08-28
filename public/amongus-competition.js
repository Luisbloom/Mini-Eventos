'use strict';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const byId = (id) => document.getElementById(id);
const View = window.AmongUsCompetitionView;
let currentEvent = null;
let currentStages = [];

function setConnection(kind, label) {
  byId('competition-dot').className = `live-dot ${kind}`;
  byId('competition-connection').textContent = label;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Fecha pendiente'
    : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

function statusLabel(status) {
  return ({ completed: '✓ COMPLETADA', active: '● EN CURSO', pending: '○ PENDIENTE' })[status]
    || String(status || 'PENDIENTE').toUpperCase();
}

function cell(tag, value, className = '') {
  const element = document.createElement(tag);
  element.textContent = value ?? '—';
  if (className) element.className = className;
  return element;
}

function competitionTable(stage, board = {}) {
  const standings = board.standings || [];
  if (!standings.length) {
    const empty = document.createElement('div');
    empty.className = 'state-panel empty compact';
    const copy = document.createElement('div');
    copy.innerHTML = '<h3>Clasificación pendiente</h3><p>Aparecerá al asignar jugadores y recibir resultados.</p>';
    empty.append(copy);
    return empty;
  }

  const table = document.createElement('table');
  table.className = 'competition-table';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  ['POS', 'JUGADOR', 'PTS', 'VIC.', 'IMP.', 'TAREAS', 'KILLS', 'ESTADO'].forEach((label) => header.append(cell('th', label)));
  head.append(header);
  const body = document.createElement('tbody');
  const qualifiers = stage.type === 'group_stage' ? Number(stage.qualifiersPerGroup) || 0 : stage.type === 'final' ? 1 : 0;

  standings.forEach((player, index) => {
    const row = document.createElement('tr');
    if (qualifiers && index === qualifiers - 1) row.classList.add('cut');
    const needsTie = board.cutoffTie && (board.decisiveTieParticipantIds || []).includes(player.participantId);
    const qualified = qualifiers && index < qualifiers;
    const state = needsTie
      ? 'DESEMPATE NECESARIO'
      : qualified ? (stage.status === 'completed' ? (stage.type === 'final' ? 'CAMPEÓN' : 'CLASIFICADO') : 'ZONA DE CLASIFICACIÓN') : '';
    row.append(
      cell('td', String(player.rank).padStart(2, '0')),
      cell('td', player.name, 'player'),
      cell('td', player.points, 'points'),
      cell('td', player.wins, 'optional'),
      cell('td', player.impostorWins, 'optional'),
      cell('td', player.allTasksGames, 'optional'),
      cell('td', player.kills, 'optional'),
      cell('td', state, `status ${needsTie ? 'tie' : 'zone'}`)
    );
    body.append(row);
  });
  table.append(head, body);
  return table;
}

function renderStageBoard(stage) {
  const tabs = byId('group-tabs');
  const target = byId('stage-leaderboard');
  tabs.replaceChildren();
  const scopes = stage.type === 'group_stage'
    ? stage.groups || []
    : [{ id: null, name: stage.name, leaderboard: stage.leaderboard }];

  const buttons = [];
  const activate = (index, focus = false) => {
    buttons.forEach((item, itemIndex) => {
      const selected = itemIndex === index;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    const scope = scopes[index];
    target.setAttribute('aria-labelledby', buttons[index].id);
    target.replaceChildren(competitionTable(stage, scope.leaderboard));
    if (focus) buttons[index].focus();
  };

  scopes.forEach((scope, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'tab';
    button.id = `group-tab-${stage.id}-${scope.id ?? index}`;
    button.setAttribute('aria-controls', 'stage-leaderboard');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.textContent = String(scope.name || `Grupo ${index + 1}`).toUpperCase();
    button.addEventListener('click', () => activate(index));
    button.addEventListener('keydown', (event) => {
      const last = buttons.length - 1;
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
      if (next === null) return;
      event.preventDefault();
      activate(next, true);
    });
    buttons.push(button);
    tabs.append(button);
  });

  if (scopes.length) activate(0);
  else target.replaceChildren(competitionTable(stage));
}

async function loadCompetition() {
  const refresh = byId('refresh-competition');
  refresh.classList.add('loading');
  try {
    const data = await getJson(`/api/events/${encodeURIComponent(slug)}/competition`);
    const stages = data.stages || [];
    currentStages = stages;
    const active = stages.find((stage) => stage.status === 'active')
      || stages.find((stage) => stage.status !== 'completed')
      || stages.at(-1);
    byId('current-stage').textContent = active?.name || 'POR DEFINIR';
    byId('competition-empty').hidden = stages.length > 0;
    byId('stage-board').hidden = !active;

    byId('stage-progress').replaceChildren(...stages.map((stage) => {
      const item = document.createElement('li');
      item.className = stage.status;
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<span>FASE ${String(stage.position).padStart(2, '0')}</span><strong></strong><b>${statusLabel(stage.status)}</b>`;
      button.querySelector('strong').textContent = stage.name;
      button.addEventListener('click', () => renderStageBoard(stage));
      item.append(button);
      return item;
    }));
    if (active) renderStageBoard(active);

    const finalStage = stages.find((stage) => stage.type === 'final');
    const finalists = finalStage?.participants || [];
    byId('finalists-panel').hidden = !finalists.length;
    byId('finalists-list').replaceChildren(...finalists.map((participant) => cell('b', participant.displayName)));
    byId('champion-banner').hidden = !data.champion;
    if (data.champion) {
      byId('champion-banner').replaceChildren(cell('span', '🏆 CAMPEÓN'), document.createTextNode(data.champion.displayName));
    }
  } finally {
    refresh.classList.remove('loading');
  }
}

async function loadParticipants() {
  try {
    const { participants = [] } = await getJson(`/api/events/${encodeURIComponent(slug)}/participants`);
    byId('participants-loading').hidden = true;
    byId('participant-summary').textContent = String(participants.length);
    byId('public-participant-count').textContent = `${String(participants.length).padStart(2, '0')} CONFIRMADOS`;
    byId('participants-empty').hidden = participants.length > 0;
    byId('participant-list').hidden = participants.length === 0;
    byId('participant-list').replaceChildren(...participants.map((participant, index) => {
      const item = document.createElement('li');
      item.append(cell('span', String(index + 1).padStart(2, '0')), cell('strong', participant.displayName), cell('small', 'CONFIRMADO'));
      return item;
    }));
  } catch (error) {
    byId('participants-loading').textContent = 'No se han podido cargar los participantes.';
    throw error;
  }
}

async function loadMatches() {
  try {
    const data = await getJson(`/api/events/${encodeURIComponent(slug)}/matches?limit=20`);
    const matches = data.matches || [];
    byId('matches-loading').hidden = true;
    byId('match-summary').textContent = String(data.count || 0);
    byId('match-total').textContent = `${String(data.count || 0).padStart(2, '0')} REGISTRADAS`;
    byId('matches-empty').hidden = matches.length > 0;
    byId('match-list').hidden = matches.length === 0;
    byId('match-list').replaceChildren(...matches.map((match) => {
      const details = View.describeMatch(match, currentStages);
      const card = document.createElement('article');
      const body = document.createElement('div');
      const winner = details.winner ? `Victoria: ${details.winner}` : 'Resultado registrado';
      body.append(cell('strong', details.title), cell('p', `${details.context ? `${details.context} · ` : ''}${formatDate(details.timestamp)} · ${winner}`));
      card.append(cell('span', `#${String(match.id).padStart(3, '0')}`), body, cell('b', `${details.playerCount ?? '—'} JUG.`));
      return card;
    }));
  } catch (error) {
    byId('matches-loading').textContent = 'No se han podido cargar los resultados.';
    throw error;
  }
}

async function loadSchedule() {
  try {
    const { schedule = [] } = await getJson(`/api/events/${encodeURIComponent(slug)}/schedule`);
    byId('schedule-empty').hidden = schedule.length > 0;
    byId('event-schedule').replaceChildren(...schedule.map((entry) => {
      const item = document.createElement('li');
      item.append(cell('time', entry.time), cell('strong', entry.title), cell('p', entry.description));
      return item;
    }));
  } catch (error) {
    byId('event-schedule').replaceChildren(cell('li', 'No se ha podido cargar la agenda.'));
    throw error;
  }
}

function configureSections(event) {
  const enabled = new Set(View.enabledSections(event));
  for (const name of ['competition', 'schedule', 'participants', 'matches']) {
    document.querySelector(`[data-module-section="${name}"]`).hidden = !enabled.has(name);
    document.querySelector(`[data-module-link="${name}"]`).hidden = !enabled.has(name);
  }
  if (!enabled.has('competition')) byId('current-stage').textContent = 'NO PUBLICADA';
  if (!enabled.has('participants')) byId('participant-summary').textContent = 'NO PUBLICADOS';
  if (!enabled.has('matches')) byId('match-summary').textContent = 'NO PUBLICADAS';
}

async function refreshLiveData(event = currentEvent) {
  if (!event) return;
  const enabled = new Set(View.enabledSections(event));
  const results = [];
  if (enabled.has('competition')) results.push(...await Promise.allSettled([loadCompetition()]));
  const remaining = [];
  if (enabled.has('participants')) remaining.push(loadParticipants());
  if (enabled.has('matches')) remaining.push(loadMatches());
  if (enabled.has('schedule')) remaining.push(loadSchedule());
  results.push(...await Promise.allSettled(remaining));
  if (results.some((result) => result.status === 'rejected')) setConnection('error', 'DATOS PARCIALES');
  else setConnection('live', 'ACTUALIZADO');
}

async function loadPage() {
  try {
    const { event } = await getJson(`/api/events/${encodeURIComponent(slug)}`);
    if (String(event.game).trim().toLowerCase() !== 'among us') throw new Error('Este visor es exclusivo de Among Us.');
    currentEvent = event;
    document.documentElement.style.setProperty('--event-accent', event.accentColor || '#d7ff3f');
    document.title = `${event.name} · Competición`;
    byId('event-name').textContent = event.name;
    byId('event-description').textContent = event.description;
    byId('event-back').href = `/eventos/${encodeURIComponent(event.slug)}`;
    byId('information-link').href = `/eventos/${encodeURIComponent(event.slug)}/informacion`;
    configureSections(event);
    byId('amongus-main').hidden = false;
    await refreshLiveData(event);
  } catch {
    byId('amongus-error').hidden = false;
    setConnection('error', 'NO DISPONIBLE');
  }
}

byId('refresh-competition').addEventListener('click', () => refreshLiveData());
loadPage();
setInterval(() => refreshLiveData(), 20000);
