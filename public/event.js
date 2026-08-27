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
  for (const [module, enabled] of Object.entries(event.modules)) {
    const visible=module==='leaderboard'&&event.modules.competition?false:enabled;
    document.querySelectorAll(`[data-module="${module}"], [data-module-link="${module}"]`).forEach((element) => { element.hidden = !visible; });
  }
  byId('information-link').href = `/eventos/${encodeURIComponent(event.slug)}/informacion`;
  // El draft y la fase regular son páginas propias, no anclas de esta.
  byId('draft-link').href = `/eventos/${encodeURIComponent(event.slug)}/competicion/draft`;
  byId('league-link').href = `/eventos/${encodeURIComponent(event.slug)}/competicion`;
  const labels = { draft: 'Draft', information: 'Información', participants: 'Participantes', leaderboard: 'Clasificación', matches: 'Resultados', registration: 'Inscripción', competition: 'Fases', schedule: 'Agenda', prizes: 'Premios' };
  byId('module-list').replaceChildren(...Object.entries(event.modules).filter(([key,enabled]) => enabled&&!(key==='leaderboard'&&event.modules.competition)).map(([key]) => {
    const span = document.createElement('span'); span.textContent = labels[key]; return span;
  }));
}

function renderEvent(event) {
  document.documentElement.style.setProperty('--event-accent', event.accentColor);
  document.title = `${event.name} · Mini Eventos Jartiland`;
  byId('event-game').textContent = event.game.toUpperCase();
  byId('event-name').textContent = event.name;
  byId('event-description').textContent = event.description;
  byId('overview-description').textContent = event.description || 'Toda la información de este evento de la comunidad.';
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

async function loadParticipants(event) {
  if (!event.modules.participants) return;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/participants`, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const { participants } = await response.json();
    byId('participants-loading').hidden = true;
    byId('public-participant-count').textContent = `${String(participants.length).padStart(2, '0')} CONFIRMADOS`;
    if (!participants.length) return void (byId('participants-empty').hidden = false);
    byId('participant-list').replaceChildren(...participants.map((participant, index) => {
      const item = document.createElement('li'); const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0'); const name = document.createElement('strong'); name.textContent = participant.displayName; const state = document.createElement('small'); state.textContent = 'CONFIRMADO'; item.append(number, name, state); return item;
    }));
    byId('participant-list').hidden = false;
  } catch { byId('participants-loading').textContent = 'No se han podido cargar los participantes.'; }
}

function renderPodium(rows) {
  return rows.slice(0, 3).map((player) => {
    const item = document.createElement('li'); item.className = `podium-card place-${player.rank}`; item.dataset.rank = String(player.rank).padStart(2, '0');
    const position = document.createElement('span'); position.className = 'podium-position'; position.textContent = `PUESTO ${String(player.rank).padStart(2, '0')}`;
    const data = document.createElement('div'); data.className = 'podium-player'; const name = document.createElement('strong'); name.className = 'podium-name'; name.textContent = player.name;
    const score = document.createElement('div'); score.className = 'podium-score'; const points = document.createElement('strong'); points.textContent = player.points; const unit = document.createElement('span'); unit.textContent = 'PTS'; score.append(points, unit); data.append(name, score); item.append(position, data); return item;
  });
}

function renderRows(rows) {
  return rows.map((player, index) => {
    const row = document.createElement('tr'); row.style.animationDelay = `${index * 35}ms`;
    const rank = document.createElement('td'); rank.className = 'rank-cell'; rank.textContent = String(player.rank).padStart(2, '0');
    const playerCell = document.createElement('td'); const name = document.createElement('strong'); name.className = 'player-name'; name.textContent = player.name; playerCell.append(name);
    const metrics = [player.points, player.wins, player.games, `${player.winRate}%`, player.kills].map((value, metricIndex) => { const cell = document.createElement('td'); cell.className = `numeric-cell ${metricIndex === 0 ? 'points-cell' : 'optional'}`; cell.textContent = value; return cell; });
    row.append(rank, playerCell, ...metrics); return row;
  });
}

async function loadLeaderboard(event) {
  if (!event.modules.leaderboard||event.modules.competition) return;
  const refresh = byId('refresh-leaderboard'); refresh.classList.add('loading');
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/leaderboard`, { cache: 'no-store' }); if (!response.ok) throw new Error();
    const data = await response.json(); byId('leaderboard-loading').hidden = true;
    if (!data.standings.length) { byId('leaderboard-empty').hidden = false; byId('leaderboard-content').hidden = true; return; }
    byId('leaderboard-empty').hidden = true; byId('event-podium').replaceChildren(...renderPodium(data.standings)); byId('event-standings').replaceChildren(...renderRows(data.standings)); byId('leaderboard-content').hidden = false;
  } catch { byId('leaderboard-loading').textContent = 'No se ha podido cargar la clasificación.'; }
  finally { refresh.classList.remove('loading'); }
}

async function loadMatches(event) {
  if (!event.modules.matches) return;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(event.slug)}/matches?limit=20`, { cache: 'no-store' }); if (!response.ok) throw new Error();
    const data = await response.json(); byId('matches-loading').hidden = true; byId('match-total').textContent = `${String(data.count).padStart(2, '0')} REGISTRADAS`;
    if (!data.matches.length) return void (byId('matches-empty').hidden = false);
    byId('match-list').replaceChildren(...data.matches.map((match) => {
      const card = document.createElement('article'); const index = document.createElement('span'); index.textContent = `#${String(match.id).padStart(3, '0')}`;
      const result = match.result || {};
      const body = document.createElement('div'); const title = document.createElement('strong'); title.textContent = result.map || result.gameMode || `Partida ${match.id}`; const meta = document.createElement('p'); const winner = result.winner ? ` · Victoria: ${result.winner}` : ''; meta.textContent = `${formatDate(match.receivedAt)}${winner}`; body.append(title, meta);
      const players = document.createElement('b'); players.textContent = `${result.playerCount ?? '—'} JUG.`; card.append(index, body, players); return card;
    })); byId('match-list').hidden = false;
  } catch { byId('matches-loading').textContent = 'No se han podido cargar los resultados.'; }
}

function competitionTable(stage, board) {
  if (!board.standings.length) { const empty=document.createElement('div');empty.className='state-panel empty compact';empty.innerHTML='<div><h3>Clasificación pendiente</h3><p>Aparecerá al asignar jugadores y recibir resultados.</p></div>';return empty; }
  const table=document.createElement('table');table.className='competition-table';table.innerHTML='<thead><tr><th>POS</th><th>JUGADOR</th><th>PTS</th><th>VIC.</th><th>IMP.</th><th>TAREAS</th><th>KILLS</th><th>ESTADO</th></tr></thead>';
  const body=document.createElement('tbody'); const qualifiers=stage.type==='group_stage'?stage.qualifiersPerGroup:(stage.type==='final'?1:0);
  board.standings.forEach((player,index)=>{const row=document.createElement('tr');if(qualifiers&&index===qualifiers-1)row.classList.add('cut');const status=board.cutoffTie&&board.decisiveTieParticipantIds.includes(player.participantId)?'DESEMPATE NECESARIO':(qualifiers&&index<qualifiers?(stage.status==='completed'?(stage.type==='final'?'CAMPEÓN':'CLASIFICADO'):'ZONA DE CLASIFICACIÓN'):'');row.innerHTML=`<td>${String(player.rank).padStart(2,'0')}</td><td class="player"></td><td class="points">${player.points}</td><td class="optional">${player.wins}</td><td class="optional">${player.impostorWins}</td><td class="optional">${player.allTasksGames}</td><td class="optional">${player.kills}</td><td class="status ${status.includes('DESEMPATE')?'tie':'zone'}"></td>`;row.querySelector('.player').textContent=player.name;row.querySelector('.status').textContent=status;body.append(row);});table.append(body);return table;
}

function renderStageBoard(stage) {
  const tabs=byId('group-tabs'); const target=byId('stage-leaderboard'); tabs.replaceChildren();
  const scopes=stage.type==='group_stage'?stage.groups:[{id:null,name:stage.name,leaderboard:stage.leaderboard}];
  scopes.forEach((scope,index)=>{const button=document.createElement('button');button.type='button';button.role='tab';button.textContent=scope.name.toUpperCase();const show=()=>{tabs.querySelectorAll('button').forEach((item)=>item.classList.remove('active'));button.classList.add('active');target.replaceChildren(competitionTable(stage,scope.leaderboard));};button.addEventListener('click',show);tabs.append(button);if(index===0)show();});
}

async function loadCompetition(event) {
  if(!event.modules.competition)return;
  try{const response=await fetch(`/api/events/${encodeURIComponent(event.slug)}/competition`,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();byId('stage-progress').replaceChildren(...data.stages.map((stage)=>{const item=document.createElement('li');item.className=stage.status;item.innerHTML=`<span>FASE ${String(stage.position).padStart(2,'0')}</span><strong></strong><b>${stage.status==='completed'?'✓ COMPLETADA':stage.status==='active'?'● EN CURSO':'○ PENDIENTE'}</b>`;item.querySelector('strong').textContent=stage.name;item.addEventListener('click',()=>renderStageBoard(stage));return item;}));const active=data.stages.find((stage)=>stage.status==='active')||data.stages.find((stage)=>stage.status!=='completed')||data.stages.at(-1);if(active)renderStageBoard(active);byId('competition-state').textContent=active?active.name.toUpperCase():'SIN FASES';const finalStage=data.stages.find((stage)=>stage.type==='final');if(finalStage?.participants?.length){const panel=byId('finalists-panel');panel.hidden=false;byId('finalists-list').replaceChildren(...finalStage.participants.map((participant)=>{const name=document.createElement('b');name.textContent=participant.displayName;return name;}));}if(data.champion){const banner=byId('champion-banner');banner.hidden=false;banner.innerHTML='<span>🏆 CAMPEÓN</span>';banner.append(document.createTextNode(data.champion.displayName));}}catch{byId('competition-state').textContent='NO DISPONIBLE';}
}

async function loadSchedule(event){if(!event.modules.schedule)return;try{const response=await fetch(`/api/events/${encodeURIComponent(event.slug)}/schedule`,{cache:'no-store'});const data=await response.json();byId('event-schedule').replaceChildren(...data.schedule.map((entry)=>{const item=document.createElement('li');const time=document.createElement('time');time.textContent=entry.time;const title=document.createElement('strong');title.textContent=entry.title;const description=document.createElement('p');description.textContent=entry.description;item.append(time,title,description);return item;}));}catch{byId('event-schedule').innerHTML='<li>No se ha podido cargar la agenda.</li>';}}
async function loadPrizes(event){if(!event.modules.prizes)return;try{const response=await fetch(`/api/events/${encodeURIComponent(event.slug)}/prizes`,{cache:'no-store'});const data=await response.json();byId('event-prizes').replaceChildren(...data.prizes.map((prize,index)=>{const card=document.createElement('article');card.innerHTML=`<span>PREMIO ${String(index+1).padStart(2,'0')}</span><h3></h3><p></p><b></b>`;card.querySelector('h3').textContent=prize.title;card.querySelector('p').textContent=prize.description;card.querySelector('b').textContent=prize.prizeValue||'';return card;}));}catch{byId('event-prizes').textContent='No se han podido cargar los premios.';}}

async function loadEvent() {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(slug)}`, { cache: 'no-store' }); if (!response.ok) throw new Error();
    const data = await response.json();
    currentEvent = data.event; renderEvent(data.event); renderRegistration(data.event, data.registrationFields); setConnection(true, 'EVENTO ONLINE');
    const mode = window.DraftView.publicEventMode(data.event);
    if (mode.upcoming) setConnection(false, 'PRÓXIMAMENTE');
    await Promise.all([loadCompetition(data.event),loadSchedule(data.event),loadParticipants(data.event),loadLeaderboard(data.event),loadMatches(data.event),loadPrizes(data.event)]);
    const section = location.pathname.split('/').filter(Boolean)[2]; if (section) document.querySelector(`#${section}`)?.scrollIntoView();
  } catch { byId('event-error').hidden = false; setConnection(false, 'NO DISPONIBLE'); }
}

byId('registration-form').addEventListener('submit', (event) => { event.preventDefault(); submitRegistration(currentEvent); });
byId('refresh-leaderboard').addEventListener('click', () => loadLeaderboard(currentEvent));
loadEvent();
setInterval(() => { if (currentEvent?.modules.leaderboard&&!currentEvent?.modules.competition) loadLeaderboard(currentEvent); }, 20000);

/* ------------------------------------------------------------------ Discord
 * Inscripción de los torneos por equipos. Sustituye al formulario genérico
 * cuando el evento lleva el módulo de draft: aquí la identidad la pone Discord
 * y lo único que escribe la persona es su Riot ID.
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
         cuando abran, sólo tendrás que poner tu Riot ID.</p>
    </div>`;
}

function pasoFormulario() {
  return `<form id="riot-form" class="riot-form" novalidate>
      <label for="riot-id">Riot ID</label>
      <input id="riot-id" name="riotId" autocomplete="off" spellcheck="false"
             placeholder="Luisbloom#NANO" required>
      <small>Lo tienes arriba a la derecha en el cliente de Riot. Lleva almohadilla.</small>
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
    default: paso.innerHTML = pasoFormulario();
  }
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
        // Sólo el Riot ID: quién eres lo resuelve el servidor con la sesión.
        body: JSON.stringify({ riotId: byId('riot-id').value })
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
