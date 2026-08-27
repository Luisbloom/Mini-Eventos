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
  article.className = 'profile-event-card';
  article.style.setProperty('--event-accent', registration.accentColor || 'var(--lime)');

  const main = document.createElement('div');
  main.className = 'profile-event-main';
  const kicker = document.createElement('p');
  kicker.className = 'profile-event-kicker';
  kicker.textContent = registration.archived ? `${registration.game} · HISTÓRICO` : registration.game;
  const title = document.createElement('h3');
  title.textContent = registration.eventName;
  const status = document.createElement('span');
  status.className = 'profile-event-status';
  status.textContent = registration.eventStatus;
  main.append(kicker, title, status);

  const details = document.createElement('div');
  details.className = 'profile-event-details';
  const facts = document.createElement('dl');
  facts.className = 'profile-event-facts';
  const registrationLabels = {
    pending: 'Pendiente de confirmación', confirmed: 'Confirmada',
    absent: 'Ausente', disqualified: 'Descalificada'
  };
  facts.append(fact('INSCRIPCIÓN', registrationLabels[registration.registrationStatus] || registration.registrationStatus));
  if (registration.riotId) facts.append(fact('RIOT ID', registration.riotId));
  if (registration.peakRank) facts.append(fact('RANGO MÁXIMO', registration.peakRank));
  if (registration.team) {
    const role = registration.team.role === 'captain' ? 'Capitán' : 'Jugador';
    facts.append(fact('EQUIPO', `${registration.team.name} · ${role}`));
  }
  details.append(facts);
  if (registration.playerBio) {
    const bio = document.createElement('p');
    bio.className = 'profile-event-bio';
    bio.textContent = registration.playerBio;
    details.append(bio);
  }
  if (registration.archived) {
    const historical = document.createElement('span');
    historical.className = 'profile-event-history';
    historical.textContent = 'EVENTO ARCHIVADO';
    details.append(historical);
  } else {
    const link = document.createElement('a');
    link.className = 'profile-event-link';
    link.href = `/eventos/${encodeURIComponent(registration.slug)}`;
    link.textContent = 'ABRIR EVENTO →';
    details.append(link);
  }

  article.append(main, details);
  return article;
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
  byId('profile-loading').hidden = true;
  byId('profile-login').hidden = true;
  byId('profile-content').hidden = false;
  byId('profile-name').textContent = profile.displayName;
  byId('profile-initials').textContent = initials(profile.displayName);
  byId('profile-event-count').textContent = String(registrations.length);
  byId('profile-active-count').textContent = String(registrations.filter((item) => !item.archived).length);
  byId('profile-team-count').textContent = String(registrations.filter((item) => item.team).length);
  byId('profile-empty').hidden = registrations.length > 0;
  byId('profile-registrations').hidden = registrations.length === 0;
  byId('profile-registrations').replaceChildren(...registrations.map(eventCard));
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
