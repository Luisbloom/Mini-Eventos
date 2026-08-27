'use strict';

const byId = (id) => document.querySelector(`#${id}`);

function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((piece) => piece[0]).join('').toUpperCase() || '?';
}

function setConnection(ok, label) {
  byId('profile-dot').className = `live-dot ${ok ? 'live' : 'error'}`;
  byId('profile-state').textContent = label;
}

function fact(label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value || '—';
  row.append(term, description);
  return row;
}

function eventCard(registration) {
  const article = document.createElement('article');
  article.className = `profile-event-card${registration.archived ? ' is-archived' : ''}`;
  article.style.setProperty('--event-accent', registration.accentColor || 'var(--lime)');

  const cover = document.createElement('figure');
  cover.className = 'profile-event-cover';
  const fallback = document.createElement('span');
  fallback.textContent = String(registration.game || 'J').slice(0, 1).toUpperCase();
  cover.append(fallback);
  if (registration.coverImage) {
    const image = document.createElement('img');
    image.src = registration.coverImage;
    image.alt = `Portada de ${registration.eventName}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.hidden = true; });
    cover.append(image);
  }

  const content = document.createElement('div');
  content.className = 'profile-event-content';
  const heading = document.createElement('header');
  const game = document.createElement('p');
  game.className = 'profile-event-game';
  game.textContent = registration.game;
  const title = document.createElement('h3');
  title.textContent = registration.eventName;
  const status = document.createElement('span');
  status.className = 'profile-event-status';
  status.textContent = registration.eventStatus;
  heading.append(game, title, status);

  const facts = document.createElement('dl');
  facts.className = 'profile-event-facts';
  const registrationLabels = {
    pending: 'Pendiente', confirmed: 'Confirmada', absent: 'Ausente', disqualified: 'Descalificada'
  };
  facts.append(fact('Inscripción', registrationLabels[registration.registrationStatus] || registration.registrationStatus));
  if (registration.riotId) facts.append(fact('Riot ID', registration.riotId));
  if (registration.peakRank) facts.append(fact('Rango máximo', registration.peakRank));
  if (registration.team) {
    const role = registration.team.role === 'captain' ? 'Capitán' : 'Jugador';
    facts.append(fact('Equipo', `${registration.team.name} · ${role}`));
  }
  content.append(heading, facts);
  if (registration.playerBio) {
    const bio = document.createElement('p');
    bio.className = 'profile-event-bio';
    bio.textContent = registration.playerBio;
    content.append(bio);
  }

  const footer = document.createElement('footer');
  if (registration.archived) {
    const historical = document.createElement('span');
    historical.className = 'profile-event-history';
    historical.textContent = 'Evento finalizado';
    footer.append(historical);
  } else {
    const link = document.createElement('a');
    link.className = 'profile-event-link';
    link.href = `/eventos/${encodeURIComponent(registration.slug)}`;
    link.textContent = 'Ir al evento →';
    footer.append(link);
  }
  content.append(footer);

  article.append(cover, content);
  return article;
}

function eventGroup(title, registrations) {
  const section = document.createElement('section');
  section.className = 'profile-event-group';
  const heading = document.createElement('header');
  const name = document.createElement('h3');
  name.textContent = title;
  const count = document.createElement('span');
  count.textContent = String(registrations.length);
  heading.append(name, count);
  const grid = document.createElement('div');
  grid.className = 'profile-event-grid';
  grid.append(...registrations.map(eventCard));
  section.append(heading, grid);
  return section;
}

function showLogin(discord) {
  byId('profile-loading').hidden = true;
  byId('profile-content').hidden = true;
  byId('profile-login').hidden = false;
  const button = byId('profile-login-button');
  if (!discord.configured) {
    button.setAttribute('aria-disabled', 'true');
    button.removeAttribute('href');
    byId('profile-login-note').textContent = 'El acceso con Discord todavía no está configurado.';
    setConnection(false, 'ACCESO NO DISPONIBLE');
    return;
  }
  setConnection(true, 'LISTO PARA ENTRAR');
}

function showProfile(profile) {
  const registrations = profile.registrations || [];
  const active = registrations.filter((item) => !item.archived);
  const archived = registrations.filter((item) => item.archived);
  byId('profile-loading').hidden = true;
  byId('profile-login').hidden = true;
  byId('profile-content').hidden = false;
  byId('profile-name').textContent = profile.displayName;
  byId('profile-initials').textContent = initials(profile.displayName);
  byId('profile-event-count').textContent = String(registrations.length);
  byId('profile-active-count').textContent = String(active.length);
  byId('profile-team-count').textContent = String(registrations.filter((item) => item.team).length);
  byId('profile-empty').hidden = registrations.length > 0;
  byId('profile-registrations').hidden = registrations.length === 0;
  const groups = [];
  if (active.length) groups.push(eventGroup('Ahora', active));
  if (archived.length) groups.push(eventGroup('Historial', archived));
  byId('profile-registrations').replaceChildren(...groups);
  setConnection(true, 'SESIÓN ACTIVA');
}

async function loadProfile() {
  try {
    const [profileResponse, discordResponse] = await Promise.all([
      fetch('/api/me/profile', { cache: 'no-store' }),
      fetch('/api/auth/discord/status', { cache: 'no-store' })
    ]);
    if (!profileResponse.ok) throw new Error('PROFILE_FAILED');
    const profile = await profileResponse.json();
    const discord = await discordResponse.json().catch(() => ({ configured: false }));
    if (!profile.authenticated) return showLogin(discord);
    showProfile(profile);
  } catch {
    byId('profile-loading').hidden = true;
    byId('profile-error').hidden = false;
    setConnection(false, 'NO DISPONIBLE');
  }
}

byId('profile-logout').addEventListener('click', async () => {
  byId('profile-logout').disabled = true;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

loadProfile();
