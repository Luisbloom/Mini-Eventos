'use strict';

const byId = (id) => document.querySelector(`#${id}`);
let token = sessionStorage.getItem('jartiland-admin-token') || '';
let events = [];
let selectedEvent = null;

function feedback(message, error = false) { const target = byId('global-feedback'); target.textContent = message; target.className = `global-feedback ${error ? 'error' : 'success'}`; }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...options.headers }, cache: 'no-store' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}
function lines(value) { return value.split('\n').map((line) => line.trim()).filter(Boolean); }
function value(id) { return byId(id).value.trim(); }
function dateInput(value) { return value ? value.slice(0, 16) : ''; }

function renderEventList() {
  byId('admin-event-list').replaceChildren(...events.map((event) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = event.id === selectedEvent?.id ? 'selected' : ''; button.dataset.id = event.id;
    const name = document.createElement('strong'); name.textContent = event.name; const meta = document.createElement('span'); meta.textContent = `${event.game} · ${event.archived ? 'ARCHIVADO' : event.status}`; button.append(name, meta); button.addEventListener('click', () => selectEvent(event.id)); return button;
  }));
}
function populateEvent(event) {
  byId('event-id').value = event?.id || '';
  byId('event-name-input').value = event?.name || '';
  byId('event-slug').value = event?.slug || '';
  byId('event-game-input').value = event?.game || '';
  byId('event-description-input').value = event?.description || '';
  byId('event-status-input').value = event?.status || 'Próximamente';
  byId('event-starts').value = dateInput(event?.startsAt);
  byId('registration-opens').value = dateInput(event?.registrationOpensAt);
  byId('registration-closes').value = dateInput(event?.registrationClosesAt);
  byId('event-minimum').value = event?.minParticipants || '';
  byId('event-capacity').value = event?.maxParticipants || '';
  byId('registrations-open').checked = event?.registrationsOpen || false;
  byId('event-accent').value = event?.accentColor || '#d7ff3f';
  byId('event-icon').value = event?.icon || 'gamepad';
  byId('event-cover-image').value = event?.coverImage || '/images/events/default-event-cover.png';
  byId('event-cover-preview').src = byId('event-cover-image').value;
  document.querySelectorAll('[data-module-input]').forEach((input) => { input.checked = event?.modules?.[input.dataset.moduleInput] ?? true; });
  byId('event-editor-title').textContent = event ? `Editar · ${event.name}` : 'Crear evento'; byId('archive-event').hidden = !event || event.archived; byId('view-event').hidden = !event;
  ['fields-section','participants-section','information-form','results-section'].forEach((id) => { byId(id).hidden = !event; });
}
function collectEvent() {
  return {
    name: value('event-name-input'), slug: value('event-slug'), game: value('event-game-input'),
    description: value('event-description-input'), status: byId('event-status-input').value,
    startsAt: byId('event-starts').value || null,
    registrationOpensAt: byId('registration-opens').value || null,
    registrationClosesAt: byId('registration-closes').value || null,
    minParticipants: byId('event-minimum').value ? Number(byId('event-minimum').value) : null,
    maxParticipants: byId('event-capacity').value ? Number(byId('event-capacity').value) : null,
    registrationsOpen: byId('registrations-open').checked,
    accentColor: byId('event-accent').value, icon: byId('event-icon').value,
    coverImage: value('event-cover-image'),
    modules: Object.fromEntries([...document.querySelectorAll('[data-module-input]')].map((input) => [input.dataset.moduleInput, input.checked]))
  };
}

byId('event-cover-image').addEventListener('input', () => {
  byId('event-cover-preview').src = value('event-cover-image') || '/images/events/default-event-cover.png';
});
byId('event-cover-preview').addEventListener('error', () => {
  const preview = byId('event-cover-preview');
  if (!preview.src.endsWith('/images/events/default-event-cover.png')) {
    preview.src = '/images/events/default-event-cover.png';
  }
});

function createFieldRow(field = {}, position = 1) {
  const row = document.createElement('div'); row.className = 'field-row';
  const inputs = [
    ['key','Key',field.key || ''], ['label','Etiqueta',field.label || ''], ['placeholder','Placeholder',field.placeholder || ''], ['options','Opciones',field.options?.join(', ') || '']
  ].map(([name, placeholder, initial]) => { const input = document.createElement('input'); input.dataset.field = name; input.placeholder = placeholder; input.value = initial; return input; });
  const type = document.createElement('select'); type.dataset.field = 'type'; ['text','select','checkbox'].forEach((name) => { const option = document.createElement('option'); option.value = name; option.textContent = name; type.append(option); }); type.value = field.type || 'text';
  const required = document.createElement('label'); required.className = 'mini-toggle'; const reqInput = document.createElement('input'); reqInput.type = 'checkbox'; reqInput.dataset.field = 'required'; reqInput.checked = field.required || false; required.append(reqInput, document.createTextNode('Oblig.'));
  const enabled = document.createElement('label'); enabled.className = 'mini-toggle'; const enabledInput = document.createElement('input'); enabledInput.type = 'checkbox'; enabledInput.dataset.field = 'enabled'; enabledInput.checked = field.enabled ?? true; enabled.append(enabledInput, document.createTextNode('Visible'));
  const order = document.createElement('input'); order.type = 'number'; order.min = 0; order.dataset.field = 'position'; order.value = field.position ?? position;
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Eliminar campo'; remove.addEventListener('click', () => row.remove());
  row.append(inputs[0], inputs[1], type, inputs[2], inputs[3], order, required, enabled, remove); return row;
}
function renderFields(fields) { byId('field-editor').replaceChildren(...fields.map(createFieldRow)); }
function collectFields() {
  return [...document.querySelectorAll('.field-row')].map((row, index) => { const get = (name) => row.querySelector(`[data-field="${name}"]`); return { key: get('key').value, label: get('label').value, type: get('type').value, placeholder: get('placeholder').value, options: get('options').value.split(',').map((item) => item.trim()).filter(Boolean), position: Number(get('position').value || index + 1), required: get('required').checked, enabled: get('enabled').checked }; });
}

function renderParticipants(participants) {
  byId('admin-participant-total').textContent = String(participants.length).padStart(2, '0'); byId('participants-placeholder').hidden = participants.length > 0;
  byId('admin-participants').replaceChildren(...participants.map((participant) => {
    const row = document.createElement('tr'); const identity = document.createElement('td'); const discord = document.createElement('strong'); discord.textContent = participant.discordUsername; const game = document.createElement('span'); game.textContent = participant.displayName; identity.append(discord, game);
    const stateCell = document.createElement('td'); const state = document.createElement('select'); ['pending','confirmed','rejected','absent','disqualified'].forEach((status) => { const option = document.createElement('option'); option.value = status; option.textContent = ({pending:'Pendiente',confirmed:'Confirmado',rejected:'Rechazado',absent:'Ausente',disqualified:'Descalificado'})[status]; state.append(option); }); state.value = participant.status; stateCell.append(state);
    const codeCell = document.createElement('td'); const code = document.createElement('input'); code.placeholder = 'Sólo administración'; code.value = participant.internalFriendCode || ''; codeCell.append(code);
    const actions = document.createElement('td'); const save = document.createElement('button'); save.type = 'button'; save.textContent = 'GUARDAR'; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'ELIMINAR'; remove.className = 'danger-text'; actions.append(save, remove);
    save.addEventListener('click', async () => { try { await api(`/api/admin/participants/${participant.id}`, { method:'PATCH', body:JSON.stringify({ status:state.value, internalFriendCode:code.value }) }); feedback('Participante actualizado.'); } catch (error) { feedback(error.message, true); } });
    remove.addEventListener('click', async () => { if (!confirm(`¿Eliminar la inscripción de ${participant.discordUsername}?`)) return; try { await api(`/api/admin/participants/${participant.id}`, { method:'DELETE' }); await loadParticipants(); feedback('Inscripción eliminada.'); } catch (error) { feedback(error.message, true); } });
    row.append(identity, stateCell, codeCell, actions); return row;
  }));
}

function renderScoring(scoring) { if(!scoring){byId('admin-scoring').replaceChildren();return;} byId('admin-scoring').replaceChildren(...scoring.rules.map((rule) => { const card=document.createElement('article'); const label=document.createElement('span'); label.textContent=rule.label; const points=document.createElement('strong'); points.textContent=`${rule.points>0?'+':''}${rule.points}`; card.append(label,points); return card; })); }
function populateInformation(data) { const {general,format,rules,tiebreakers,faqs}=data.information; byId('intro').value=general.intro; byId('date').value=general.date; byId('time').value=general.time; byId('participants').value=general.participantCount??''; byId('status').value=general.status; byId('phase').value=general.phase; byId('groups-enabled').checked=format.groupsEnabled; byId('classification').value=format.classification; byId('final').value=format.final; byId('rules').value=rules.join('\n'); byId('tiebreakers').value=tiebreakers.join('\n'); byId('faqs').value=faqs.map((faq)=>`${faq.question} || ${faq.answer}`).join('\n'); renderScoring(data.scoring); }
function collectInformation() { return { general:{intro:value('intro'),date:byId('date').value,time:byId('time').value,participantCount:byId('participants').value?Number(byId('participants').value):null,status:value('status'),phase:value('phase')}, format:{groupsEnabled:byId('groups-enabled').checked,classification:value('classification'),final:value('final')}, rules:lines(byId('rules').value),tiebreakers:lines(byId('tiebreakers').value),faqs:lines(byId('faqs').value).map((line,index)=>{const split=line.indexOf('||');if(split<1)throw new Error(`FAQ línea ${index+1}: usa Pregunta || Respuesta`);return{question:line.slice(0,split).trim(),answer:line.slice(split+2).trim()};}) }; }

function formatAuditDate(value){if(!value)return 'No informado';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('es-ES');}
function auditFact(term,value,className=''){const wrapper=document.createElement('div');const dt=document.createElement('dt');const dd=document.createElement('dd');dt.textContent=term;dd.textContent=value||'No informado';if(className)dd.className=className;wrapper.append(dt,dd);return wrapper;}
function renderMatchAudit(match){
  const row=document.createElement('article');row.className='match-audit-card';const data=document.createElement('div');data.className='match-audit-main';
  const heading=document.createElement('div');heading.className='match-audit-title';const title=document.createElement('strong');const map=match.report?.map||'Mapa no informado';title.textContent=match.matchNumber?`Partida ${String(match.matchNumber).padStart(2,'0')} · ${map}`:`Resultado #${match.id} · ${map}`;const record=document.createElement('span');record.textContent=`REGISTRO #${match.id}`;heading.append(title,record);
  const stageName=match.stageName||(match.stageId?`Fase #${match.stageId}`:'Sin fase');const groupName=match.groupName||(match.groupId?`Grupo #${match.groupId}`:'Sin grupo');const scope=document.createElement('p');scope.className='match-scope';scope.textContent=`${stageName} › ${groupName}`;
  const hostIdentity=[match.hostIdentifier||(match.hostId?`HOST #${match.hostId}`:null),match.hostName].filter(Boolean).join(' · ')||'Sin host';const status=match.matchStatus||'VALID';const facts=document.createElement('dl');facts.className='match-audit-facts';facts.append(auditFact('ESTADO',status,status==='VOID'?'match-status void':'match-status'),auditFact('ORIGEN',match.origin||'REPORTER'),auditFact('ENVIADO POR',match.submittedBy||'No informado'),auditFact('HOST',hostIdentity),auditFact('RECIBIDO',formatAuditDate(match.receivedAt)),auditFact('JUGADO',formatAuditDate(match.playedAt)),auditFact('REPORT ID',match.report?.reportId||'No informado'));if(match.voidReason)facts.append(auditFact('MOTIVO DE ANULACIÓN',match.voidReason));data.append(heading,scope,facts);
  const actions=document.createElement('div');actions.className='match-actions';const voidButton=document.createElement('button');voidButton.type='button';voidButton.textContent='ANULAR';voidButton.hidden=status==='VOID';voidButton.addEventListener('click',async()=>{const reason=prompt('Motivo de anulación');if(!reason)return;if(!confirm(`¿Anular la partida #${match.id}? Permanecerá en el historial sin puntuar.`))return;try{await api(`/api/admin/events/${selectedEvent.id}/matches/${match.id}/void`,{method:'PATCH',body:JSON.stringify({reason})});await loadResults();feedback('Partida anulada y clasificación recalculada.');}catch(error){feedback(error.message,true);}});const remove=document.createElement('button');remove.type='button';remove.textContent='ELIMINAR';remove.addEventListener('click',async()=>{if(!confirm('¿Eliminar definitivamente este resultado? La clasificación se recalculará.'))return;try{await api(`/api/admin/events/${selectedEvent.id}/matches/${match.id}`,{method:'DELETE'});await loadResults();feedback('Resultado eliminado.');}catch(error){feedback(error.message,true);}});actions.append(voidButton,remove);row.append(data,actions);return row;
}
function renderResults(matches, leaderboard) {
  byId('admin-match-total').textContent=String(matches.count).padStart(2,'0'); byId('matches-placeholder').hidden=matches.count>0;
  byId('admin-leaders').replaceChildren(...leaderboard.standings.slice(0,3).map((player)=>{const card=document.createElement('article');const rank=document.createElement('span');rank.textContent=`#${player.rank}`;const name=document.createElement('strong');name.textContent=player.name;const points=document.createElement('b');points.textContent=`${player.points} PTS`;card.append(rank,name,points);return card;}));
  byId('admin-matches').replaceChildren(...matches.matches.map(renderMatchAudit));
}
async function loadParticipants(){renderParticipants((await api(`/api/admin/events/${selectedEvent.id}/participants`)).participants);}
async function loadResults(){const [matches,leaderboard]=await Promise.all([api(`/api/admin/events/${selectedEvent.id}/matches`),api(`/api/admin/events/${selectedEvent.id}/leaderboard`)]);renderResults(matches,leaderboard);}
async function selectEvent(id) { selectedEvent=events.find((event)=>event.id===Number(id)); renderEventList(); populateEvent(selectedEvent); try { const [fields,participants,information,matches,leaderboard]=await Promise.all([api(`/api/admin/events/${id}/fields`),api(`/api/admin/events/${id}/participants`),api(`/api/admin/events/${id}/information`),api(`/api/admin/events/${id}/matches`),api(`/api/admin/events/${id}/leaderboard`)]); renderFields(fields.fields); renderParticipants(participants.participants); populateInformation(information); renderResults(matches,leaderboard); window.dispatchEvent(new CustomEvent('jartiland:event-selected',{detail:{event:selectedEvent,participants:participants.participants}})); } catch(error){feedback(error.message,true);} }
async function loadEvents(preferredId) { const data=await api('/api/admin/events'); events=data.events; byId('admin-workspace').hidden=false; renderEventList(); const id=preferredId||selectedEvent?.id||events[0]?.id; if(id)await selectEvent(id); else populateEvent(null); byId('admin-dot').className='live-dot live';byId('admin-state').textContent='CONTROL ONLINE'; }

byId('connect-admin').addEventListener('click',async()=>{token=value('admin-token');if(!token)return feedback('Introduce el ADMIN_TOKEN.',true);try{sessionStorage.setItem('jartiland-admin-token',token);await loadEvents();feedback('Acceso correcto.');}catch(error){sessionStorage.removeItem('jartiland-admin-token');feedback(error.message,true);byId('admin-dot').className='live-dot error';}});
byId('new-event').addEventListener('click',()=>{selectedEvent=null;renderEventList();populateEvent(null);window.scrollTo({top:byId('event-form').offsetTop-100,behavior:'smooth'});});
byId('event-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const id=byId('event-id').value;const data=await api(id?`/api/admin/events/${id}`:'/api/admin/events',{method:id?'PUT':'POST',body:JSON.stringify(collectEvent())});await loadEvents(data.event.id);feedback(id?'Evento actualizado.':'Evento creado con campos mínimos de inscripción.');}catch(error){feedback(error.message,true);}});
byId('archive-event').addEventListener('click',async()=>{if(!selectedEvent||!confirm(`¿Archivar ${selectedEvent.name}? Sus datos no se borrarán.`))return;try{await api(`/api/admin/events/${selectedEvent.id}`,{method:'DELETE'});selectedEvent=null;await loadEvents();feedback('Evento archivado; sus datos se conservan.');}catch(error){feedback(error.message,true);}});
byId('view-event').addEventListener('click',()=>{if(selectedEvent)window.open(`/eventos/${encodeURIComponent(selectedEvent.slug)}`,'_blank','noopener');});
byId('add-field').addEventListener('click',()=>byId('field-editor').append(createFieldRow({},document.querySelectorAll('.field-row').length+1)));
byId('save-fields').addEventListener('click',async()=>{try{await api(`/api/admin/events/${selectedEvent.id}/fields`,{method:'PUT',body:JSON.stringify({fields:collectFields()})});await selectEvent(selectedEvent.id);feedback('Formulario de inscripción actualizado.');}catch(error){feedback(error.message,true);}});
byId('information-form').addEventListener('submit',async(event)=>{event.preventDefault();try{await api(`/api/admin/events/${selectedEvent.id}/information`,{method:'PUT',body:JSON.stringify({information:collectInformation()})});feedback('Información pública actualizada.');}catch(error){feedback(error.message,true);}});
byId('manual-match-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const report=JSON.parse(byId('manual-match-json').value);await api(`/api/admin/events/${selectedEvent.id}/matches`,{method:'POST',body:JSON.stringify({report})});byId('manual-match-json').value='';await loadResults();feedback('Resultado añadido y clasificación recalculada.');}catch(error){feedback(error instanceof SyntaxError?'El informe no es JSON válido.':error.message,true);}});
window.jartilandAdmin={api,feedback,getSelectedEvent:()=>selectedEvent,refresh:()=>selectedEvent&&selectEvent(selectedEvent.id)};
if(token){byId('admin-token').value=token;loadEvents().catch(()=>{sessionStorage.removeItem('jartiland-admin-token');});}
