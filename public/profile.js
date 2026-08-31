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

const MAPAS = {
  ascent: 'Ascent', bind: 'Bind', breeze: 'Breeze', fracture: 'Fracture',
  haven: 'Haven', icebox: 'Icebox', lotus: 'Lotus', pearl: 'Pearl',
  split: 'Split', sunset: 'Sunset', abyss: 'Abyss'
};
const nombreDeMapa = (clave) => MAPAS[clave] || String(clave || '').toUpperCase();

/** El equipo con nombres y apellidos, no sólo el nombre del equipo. */
function plantilla(team) {
  if (!team?.members?.length) return null;
  const caja = document.createElement('div');
  caja.className = 'profile-roster';

  const titulo = document.createElement('p');
  titulo.className = 'profile-roster-title';
  titulo.textContent = 'Tus compañeros';
  caja.append(titulo);

  const lista = document.createElement('ul');
  for (const miembro of team.members) {
    const fila = document.createElement('li');
    if (miembro.role === 'captain') fila.className = 'is-captain';
    fila.textContent = miembro.displayName || '—';
    if (miembro.role === 'captain') {
      const marca = document.createElement('span');
      marca.textContent = 'capitán';
      fila.append(marca);
    }
    lista.append(fila);
  }
  caja.append(lista);
  return caja;
}

/** Cómo va el equipo. Sin liga generada no se enseña nada. */
function posicion(registration) {
  const fila = registration.standing;
  if (!fila) return null;
  const caja = document.createElement('div');
  caja.className = 'profile-standing';
  if (fila.qualified) caja.classList.add('is-qualified');

  const puesto = document.createElement('b');
  puesto.textContent = `${fila.position}º`;

  const detalle = document.createElement('span');
  const diferencia = fila.roundDiff > 0 ? `+${fila.roundDiff}` : String(fila.roundDiff);
  detalle.textContent = `${fila.wins}V · ${fila.losses}D · ${diferencia} rondas`;

  caja.append(puesto, detalle);

  // Un empate sin resolver se dice, no se disimula con el orden alfabético.
  if (fila.tieRequiresAdmin) {
    const aviso = document.createElement('small');
    aviso.textContent = 'Empate pendiente de resolver por la organización';
    caja.append(aviso);
  }
  return caja;
}

/** Contra quién toca. Es lo primero que se busca al abrir el perfil. */
function proximoPartido(registration) {
  const partido = registration.nextMatch;
  if (!partido) return null;
  const caja = document.createElement('div');
  caja.className = 'profile-next';

  const etiqueta = document.createElement('p');
  etiqueta.className = 'profile-next-label';
  etiqueta.textContent = partido.matchday
    ? `Próximo partido · jornada ${partido.matchday}`
    : 'Próximo partido';

  const rival = document.createElement('p');
  rival.className = 'profile-next-rival';
  rival.textContent = partido.opponentName || 'Por determinar';

  caja.append(etiqueta, rival);

  const detalles = [];
  if (partido.bestOf > 1) detalles.push(`BO${partido.bestOf}`);
  if (partido.maps?.length) detalles.push(partido.maps.map(nombreDeMapa).join(' · '));
  if (detalles.length) {
    const pie = document.createElement('p');
    pie.className = 'profile-next-detail';
    pie.textContent = detalles.join(' — ');
    caja.append(pie);
  }
  return caja;
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

  for (const pieza of [proximoPartido(registration), posicion(registration), plantilla(registration.team)]) {
    if (pieza) content.append(pieza);
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

    // Si ya hay competición, se va directo a ella: es donde está lo que
    // importa una vez formados los equipos.
    if (registration.standing || registration.nextMatch) {
      const competicion = document.createElement('a');
      competicion.className = 'profile-event-link is-secondary';
      competicion.href = `/eventos/${encodeURIComponent(registration.slug)}/competicion`;
      competicion.textContent = 'Ver competición →';
      footer.append(competicion);
    }
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
  const avatar = byId('profile-avatar-image');
  const fallback = byId('profile-initials');
  avatar.hidden = true;
  fallback.hidden = false;
  if (profile.avatar) {
    avatar.addEventListener('load', () => {
      avatar.hidden = false;
      fallback.hidden = true;
    }, { once: true });
    avatar.addEventListener('error', () => {
      avatar.hidden = true;
      fallback.hidden = false;
    }, { once: true });
    avatar.src = profile.avatar;
  }
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
