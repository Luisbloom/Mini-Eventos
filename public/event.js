'use strict';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let currentEvent;

function byId(id) { return document.querySelector(`#${id}`); }
function formatDate(value, includeTime = true) {
  if (!value) return 'Por anunciar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Por anunciar';
  return new Intl.DateTimeFormat('es-ES', includeTime ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' }).format(date);
}
function iconLabel(icon) { return ({ crewmate: 'AU', blocks: 'MC', crosshair: 'V', trophy: '★', gamepad: 'J' })[icon] || 'J'; }
function setConnection(ok, text) { byId('event-dot').className = `live-dot ${ok ? 'live' : 'error'}`; byId('event-connection').textContent = text; }

function renderMinimum(event) {
  const panel = byId('event-quorum');
  const minimum = event.minParticipants;
  byId('event-minimum-count').textContent = minimum ? `${minimum} PERSONAS` : 'POR DEFINIR';
  if (!minimum) {
    panel.classList.remove('reached');
    byId('event-minimum-copy').textContent = 'POR DEFINIR';
    byId('event-minimum-status').textContent = 'La organización confirmará el mínimo necesario.';
    byId('event-minimum-progress').style.width = '0%';
    return;
  }
  const remaining = Math.max(0, minimum - event.participantCount);
  const reached = remaining === 0;
  panel.classList.toggle('reached', reached);
  byId('event-minimum-copy').textContent = `${event.participantCount} / ${minimum} PERSONAS`;
  byId('event-minimum-status').textContent = reached
    ? 'Mínimo alcanzado: el evento ya cuenta con las inscripciones necesarias.'
    : `Faltan ${remaining} ${remaining === 1 ? 'persona' : 'personas'} para poder realizar el evento.`;
  byId('event-minimum-progress').style.width = `${Math.min(100, Math.round((event.participantCount / minimum) * 100))}%`;
}

function configureModules(event) {
  byId('information-link').href = `/eventos/${encodeURIComponent(event.slug)}/informacion`;
  byId('information-link').hidden = !event.modules.information;
  byId('competition-link').href = `/eventos/${encodeURIComponent(event.slug)}/competicion`;
  byId('competition-link').hidden = !event.modules.competition;
  byId('competition-link-copy').textContent = window.EventView.competitionAccessCopy(event);
  byId('premios').hidden = !event.modules.prizes;
  byId('inscripcion').hidden = !event.modules.registration;
}

function renderEvent(event) {
  document.documentElement.style.setProperty('--event-accent', event.accentColor);
  document.title = `${event.name} · Mini Eventos Jartiland`;
  byId('event-game').textContent = event.game.toUpperCase();
  byId('event-name').textContent = event.name;
  byId('event-description').textContent = event.description;
  byId('event-status').textContent = event.status;
  byId('event-date').textContent = formatDate(event.startsAt);
  byId('event-participant-count').textContent = event.maxParticipants ? `${event.participantCount} / ${event.maxParticipants}` : event.participantCount;
  renderMinimum(event);
  const cover = byId('event-hero-cover');
  cover.src = event.bannerImage || event.coverImage || '/images/events/default-event-cover.png';
  cover.addEventListener('error', () => { cover.src = '/images/events/default-event-cover.png'; }, { once: true });
  byId('event-monogram').textContent = iconLabel(event.icon);
  byId('hero-registration-state').textContent = event.registration.label.toUpperCase();
  byId('register-cta').hidden = !event.modules.registration || !event.registration.available;
  configureModules(event);
  byId('event-main').hidden = false;
}

function fieldControl(field) {
  const label = document.createElement('label');
  label.className = field.type === 'checkbox' ? 'dynamic-field checkbox-field' : 'dynamic-field';
  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona una opción'; input.append(empty);
    for (const value of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
  } else {
    input = document.createElement('input'); input.type = field.type;
  }
  input.name = field.key; input.id = `field-${field.key}`; input.required = field.required;
  if (field.placeholder) input.placeholder = field.placeholder;
  const caption = document.createElement('span'); caption.textContent = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'checkbox') label.append(input, caption); else label.append(caption, input);
  return label;
}

function renderRegistration(event, fields) {
  // Los torneos por equipos usan otro camino: la identidad la pone Discord.
  if (event.modules?.draft) { renderDiscordRegistration(event); return; }

  const form = byId('registration-form');
  const closed = byId('registration-closed');
  form.hidden = !event.registration.available;
  closed.hidden = event.registration.available;
  if (!event.registration.available) {
    byId('registration-closed-title').textContent = event.registration.label.toUpperCase();
    byId('registration-closed-copy').textContent = event.registration.code === 'FULL' ? 'Se ha alcanzado el máximo de participantes.' : 'Ahora mismo no se admiten nuevas inscripciones.';
    return;
  }
  byId('registration-fields').replaceChildren(...fields.map(fieldControl));
  const same = form.elements.same_as_discord;
  const discord = form.elements.discord_username;
  const gameName = form.elements.game_name;
  if (same && discord && gameName) {
    const sync = () => { if (same.checked) { gameName.value = discord.value; gameName.disabled = true; } else gameName.disabled = false; };
    same.addEventListener('change', sync); discord.addEventListener('input', sync);
  }
}

async function submitRegistration(event) {
  const form = byId('registration-form');
  const feedback = byId('registration-feedback');
  if (!form.reportValidity()) return;
  const values = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
  }
  byId('registration-submit').disabled = true; feedback.textContent = 'Enviando inscripción…'; feedback.className = '';
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'No se pudo completar la inscripción.');
    form.hidden = true; byId('registration-success').hidden = false;
  } catch (error) { feedback.textContent = error.message; feedback.className = 'error'; byId('registration-submit').disabled = false; }
}

async function loadPrizes(event){if(!event.modules.prizes)return;try{const response=await fetch(`/api/events/${encodeURIComponent(event.slug)}/prizes`,{cache:'no-store'});const data=await response.json();byId('event-prizes').replaceChildren(...data.prizes.map((prize,index)=>{const card=document.createElement('article');card.innerHTML=`<span>PREMIO ${String(index+1).padStart(2,'0')}</span><h3></h3><p></p><b></b>`;card.querySelector('h3').textContent=prize.title;card.querySelector('p').textContent=prize.description;card.querySelector('b').textContent=prize.prizeValue||'';return card;}));}catch{byId('event-prizes').textContent='No se han podido cargar los premios.';}}

async function loadEvent() {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(slug)}`, { cache: 'no-store' }); if (!response.ok) throw new Error();
    const data = await response.json();
    currentEvent = data.event; renderEvent(data.event); renderRegistration(data.event, data.registrationFields); setConnection(true, 'EVENTO ONLINE');
    const mode = window.DraftView.publicEventMode(data.event);
    if (mode.upcoming) setConnection(false, 'PRÓXIMAMENTE');
    await loadPrizes(data.event);
    const section = location.pathname.split('/').filter(Boolean)[2]; if (section) document.querySelector(`#${section}`)?.scrollIntoView();
  } catch { byId('event-error').hidden = false; setConnection(false, 'NO DISPONIBLE'); }
}

byId('registration-form').addEventListener('submit', (event) => { event.preventDefault(); submitRegistration(currentEvent); });
loadEvent();

/* ------------------------------------------------------------------ Discord
 * Inscripción de los torneos por equipos. Sustituye al formulario genérico
 * cuando el evento lleva el módulo de draft: aquí la identidad la pone Discord
 * y la persona completa únicamente su perfil de juego.
 */

const ERRORES_INSCRIPCION = {
  AUTH_REQUIRED: 'Entra con Discord antes de inscribirte.',
  INVALID_RIOT_ID: null,                    // el backend ya explica cuál es el fallo
  ALREADY_REGISTERED: 'Ya estás inscrito en este torneo.',
  RIOT_ID_ALREADY_REGISTERED: 'Ese Riot ID ya está inscrito en este torneo.',
  MODULE_DISABLED: 'Este torneo no admite inscripción por equipos.',
  REGISTRATION_CLOSED: 'Las inscripciones todavía no están abiertas.'
};

function mensajeDeError(cuerpo, porDefecto) {
  const code = cuerpo?.error?.code;
  if (code && ERRORES_INSCRIPCION[code] === null) return cuerpo.error.message;
  return (code && ERRORES_INSCRIPCION[code]) || cuerpo?.error?.message || porDefecto;
}

/** Iniciales del nombre: evita traer el avatar, cuya URL lleva el id de Discord. */
const iniciales = (nombre) => window.DraftView.initials(nombre);

async function cargarEstadoDiscord(event) {
  const [estado, yo] = await Promise.all([
    fetch('/api/auth/discord/status', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ configured: false })),
    fetch(`/api/me?event=${encodeURIComponent(event.slug)}`, { cache: 'no-store' })
      .then((r) => r.json()).catch(() => ({ authenticated: false }))
  ]);
  return { estado, yo };
}

function pintarIdentidad(yo) {
  const caja = byId('discord-identity');
  if (!yo.authenticated) { caja.hidden = true; return; }
  caja.hidden = false;
  byId('discord-initials').textContent = iniciales(yo.displayName);
  byId('discord-name').textContent = yo.displayName;
}

function volverAqui(event) {
  return encodeURIComponent(`/eventos/${event.slug}`);
}

function pasoNoConfigurado() {
  return `<div class="discord-note">
      <strong>Acceso con Discord</strong>
      <p>Todavía no disponible. En cuanto esté listo podrás inscribirte desde aquí.</p>
    </div>`;
}

function pasoEntrar(event) {
  return `<div class="discord-note">
      <p>Para participar tienes que identificarte con Discord. Así no hace falta que escribas
         tu usuario y no hay forma de equivocarse.</p>
    </div>
    <a class="discord-button" href="/auth/discord?redirect=${volverAqui(event)}">
      CONTINUAR CON DISCORD <span aria-hidden="true">→</span>
    </a>`;
}

function pasoCerrado(etiqueta) {
  // La etiqueta la escribe administración desde el panel: se escapa igual.
  return `<div class="discord-note">
      <strong>${escaparTexto(etiqueta || 'Inscripciones cerradas')}</strong>
      <p>Las inscripciones todavía no están abiertas. Tu cuenta ya está conectada:
         cuando abran, sólo tendrás que completar tu perfil de jugador.</p>
    </div>`;
}

function pasoFormulario(event) {
  const ranks = event.valorantPeakRanks?.length ? event.valorantPeakRanks : ['Sin rango'];
  const rankOptions = ranks
    .map((rank) => `<option value="${escaparTexto(rank)}">${escaparTexto(rank)}</option>`).join('');
  return `<form id="riot-form" class="riot-form" novalidate>
      <div class="riot-field">
        <label for="riot-id">Riot ID</label>
        <input id="riot-id" name="riotId" autocomplete="off" spellcheck="false"
               placeholder="Luisbloom#NANO" required>
        <small>Lo tienes arriba a la derecha en el cliente de Riot. Lleva almohadilla.</small>
      </div>
      <div class="riot-field">
        <label for="peak-rank">Rango máximo alcanzado</label>
        <select id="peak-rank" name="peakRank" required>${rankOptions}</select>
        <small>Selecciona el rango más alto que hayas alcanzado en competitivo.</small>
      </div>
      <div class="riot-field">
        <label for="player-bio">Sobre ti <span>Opcional</span></label>
        <textarea id="player-bio" name="playerBio" rows="4" maxlength="160"
          placeholder="Cuánto tiempo llevas jugando, roles preferidos o algún comentario…"></textarea>
        <div class="riot-field-meta"><small>Este texto sólo lo verá la organización.</small><span id="player-bio-count">0 / 160</span></div>
      </div>
      <button type="submit">INSCRIBIRME <span aria-hidden="true">→</span></button>
      <p id="riot-feedback" role="status"></p>
    </form>`;
}

function pasoInscrito(datos) {
  const estados = { pending: 'Pendiente de confirmación', confirmed: 'Confirmada', cancelled: 'Cancelada' };
  return `<div class="discord-done">
      <span aria-hidden="true">✓</span>
      <div>
        <strong>INSCRIPCIÓN REALIZADA</strong>
        <dl>
          <div><dt>Riot ID</dt><dd>${escaparTexto(datos.riotId || '—')}</dd></div>
          <div><dt>Rango máximo</dt><dd>${escaparTexto(datos.peakRank || 'No indicado')}</dd></div>
          ${datos.playerBio ? `<div><dt>Sobre ti</dt><dd>${escaparTexto(datos.playerBio)}</dd></div>` : ''}
          <div><dt>Estado</dt><dd>${escaparTexto(estados[datos.registrationStatus] || datos.registrationStatus || '—')}</dd></div>
        </dl>
      </div>
    </div>`;
}

/** El nombre y el Riot ID los escribe una persona: nunca se inyectan como HTML. */
const escaparTexto = (valor) => window.DraftView.escapeHtml(valor);

async function renderDiscordRegistration(event) {
  const caja = byId('discord-registration');
  caja.hidden = false;
  byId('registration-form').hidden = true;
  byId('registration-closed').hidden = true;

  const { estado, yo } = await cargarEstadoDiscord(event);
  pintarIdentidad(yo);

  const paso = byId('discord-step');
  const datos = yo.event || {};

  if (!event.registration.available && !datos.registered) {
    paso.innerHTML = pasoCerrado(event.registration.label);
    return;
  }

  switch (window.DraftView.registrationState({ discordConfigured: estado.configured, me: yo })) {
    case 'unavailable': paso.innerHTML = pasoNoConfigurado(); return;
    case 'login': paso.innerHTML = pasoEntrar(event); return;
    case 'registered': paso.innerHTML = pasoInscrito(datos); return;
    case 'closed': paso.innerHTML = pasoCerrado(datos.registrationLabel); return;
    default: paso.innerHTML = pasoFormulario(event);
  }
  const bio = byId('player-bio');
  const count = byId('player-bio-count');
  bio.addEventListener('input', () => { count.textContent = `${bio.value.length} / 160`; });
  byId('riot-form').addEventListener('submit', async (submit) => {
    submit.preventDefault();
    const boton = byId('riot-form').querySelector('button');
    const aviso = byId('riot-feedback');
    boton.disabled = true;
    aviso.textContent = '';
    try {
      const respuesta = await fetch(`/api/events/${encodeURIComponent(event.slug)}/valorant/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Quién eres lo resuelve el servidor con la sesión; aquí sólo viaja tu perfil de juego.
        body: JSON.stringify({
          riotId: byId('riot-id').value,
          peakRank: byId('peak-rank').value,
          playerBio: byId('player-bio').value
        })
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        aviso.textContent = mensajeDeError(cuerpo, 'No se ha podido completar la inscripción.');
        boton.disabled = false;
        return;
      }
      await renderDiscordRegistration(event);
    } catch {
      aviso.textContent = 'No se ha podido conectar. Inténtalo otra vez.';
      boton.disabled = false;
    }
  });
}

document.addEventListener('click', async (click) => {
  if (click.target?.id !== 'discord-logout') return;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});
