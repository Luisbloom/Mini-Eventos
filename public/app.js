'use strict';

const REFRESH_INTERVAL_MS = 20_000;
const ALLOWED_COLORS = new Set([
  'red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white',
  'purple', 'brown', 'cyan', 'lime', 'maroon', 'rose', 'banana', 'gray', 'tan', 'coral'
]);

const elements = {
  liveDot: document.querySelector('#live-dot'),
  liveLabel: document.querySelector('#live-label'),
  playerCount: document.querySelector('#player-count'),
  matchCount: document.querySelector('#match-count'),
  lastUpdated: document.querySelector('#last-updated'),
  demoBadge: document.querySelector('#demo-badge'),
  refresh: document.querySelector('#refresh'),
  loading: document.querySelector('#loading-state'),
  empty: document.querySelector('#empty-state'),
  content: document.querySelector('#ranking-content'),
  podium: document.querySelector('#podium'),
  standings: document.querySelector('#standings')
};

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

function crewColor(value) {
  const color = String(value || '').toLowerCase();
  return ALLOWED_COLORS.has(color) ? color : 'gray';
}

function createCrew(color, table = false) {
  const crew = document.createElement('span');
  crew.className = `crew ${table ? 'table-crew ' : ''}${crewColor(color)}`;
  crew.setAttribute('aria-hidden', 'true');
  return crew;
}

function createPodiumCard(player) {
  const item = document.createElement('li');
  item.className = `podium-card place-${player.rank}`;
  item.dataset.rank = String(player.rank).padStart(2, '0');
  item.style.animationDelay = `${player.rank * 80}ms`;

  const position = document.createElement('span');
  position.className = 'podium-position';
  position.textContent = `POSICIÓN ${String(player.rank).padStart(2, '0')}`;

  const details = document.createElement('div');
  details.className = 'podium-player';
  const name = document.createElement('strong');
  name.className = 'podium-name';
  name.textContent = player.name;
  const score = document.createElement('div');
  score.className = 'podium-score';
  const points = document.createElement('strong');
  points.textContent = player.points;
  const label = document.createElement('span');
  label.textContent = 'PUNTOS';
  score.append(points, label);
  const secondary = document.createElement('div');
  secondary.className = 'podium-detail';
  secondary.textContent = `${player.wins} VICTORIAS · ${player.games} PARTIDAS`;
  details.append(name, score, secondary);

  item.append(position, createCrew(player.color), details);
  return item;
}

function numericCell(value, className = '') {
  const cell = document.createElement('td');
  cell.className = `numeric-cell ${className}`.trim();
  cell.textContent = value;
  return cell;
}

function createStandingRow(player, index) {
  const row = document.createElement('tr');
  row.style.animationDelay = `${Math.min(index * 45, 360)}ms`;

  const rank = document.createElement('td');
  rank.className = 'rank-cell';
  rank.textContent = String(player.rank).padStart(2, '0');

  const playerCell = document.createElement('td');
  const playerInner = document.createElement('div');
  playerInner.className = 'player-cell';
  const name = document.createElement('strong');
  name.className = 'player-name';
  name.textContent = player.name;
  playerInner.append(createCrew(player.color, true), name);
  playerCell.append(playerInner);

  const rateCell = numericCell(`${player.winRate}%`, 'optional');
  const rateBar = document.createElement('span');
  rateBar.className = 'rate-bar';
  const rateFill = document.createElement('i');
  rateFill.style.width = `${Math.max(0, Math.min(100, player.winRate))}%`;
  rateBar.append(rateFill);
  rateCell.append(rateBar);

  row.append(
    rank,
    playerCell,
    numericCell(player.points, 'points-cell'),
    numericCell(player.wins, 'optional'),
    numericCell(player.games, 'optional'),
    rateCell,
    numericCell(player.kills, 'optional')
  );
  return row;
}

function setConnection(status, label) {
  elements.liveDot.className = `live-dot ${status}`;
  elements.liveLabel.textContent = label;
}

function renderLeaderboard(data) {
  elements.playerCount.textContent = String(data.playerCount).padStart(2, '0');
  elements.matchCount.textContent = String(data.matchCount).padStart(2, '0');
  elements.lastUpdated.textContent = data.lastUpdated
    ? dateFormatter.format(new Date(data.lastUpdated)).toUpperCase()
    : 'ESPERANDO';
  elements.demoBadge.hidden = !data.hasDemoData;

  elements.loading.hidden = true;
  const isEmpty = data.standings.length === 0;
  elements.empty.hidden = !isEmpty;
  elements.content.hidden = isEmpty;

  if (!isEmpty) {
    const topThree = data.standings.slice(0, 3);
    elements.podium.replaceChildren(...topThree.map(createPodiumCard));
    elements.standings.replaceChildren(...data.standings.map(createStandingRow));
  }
}

async function refreshLeaderboard() {
  elements.refresh.disabled = true;
  elements.refresh.classList.add('loading');

  try {
    const response = await fetch('/api/leaderboard', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    renderLeaderboard(await response.json());
    setConnection('live', 'EN DIRECTO');
  } catch {
    elements.loading.hidden = false;
    elements.loading.textContent = 'No se ha podido cargar la clasificación. Reintentando…';
    setConnection('error', 'SIN CONEXIÓN');
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.classList.remove('loading');
  }
}

elements.refresh.addEventListener('click', refreshLeaderboard);
refreshLeaderboard();
window.setInterval(refreshLeaderboard, REFRESH_INTERVAL_MS);
