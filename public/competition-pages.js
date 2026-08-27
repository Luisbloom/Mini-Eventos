'use strict';

(() => {
  const View = window.CompetitionView;
  const Renderers = window.CompetitionRenderers;
  const route = View.routeFor(window.location.pathname);
  const byId = (id) => document.getElementById(id);
  let stream = null;
  let refreshPending = false;

  function connection(kind, label) {
    byId('competition-dot').className = `live-dot ${kind}`;
    byId('competition-connection').textContent = label;
  }

  function showError(title, copy) {
    byId('competition-loading').hidden = true;
    byId('competition-main').hidden = true;
    byId('competition-error').hidden = false;
    byId('competition-error-title').textContent = title;
    byId('competition-error-copy').textContent = copy;
    byId('competition-error-back').href = `/eventos/${encodeURIComponent(route.slug)}`;
    connection('error', 'NO DISPONIBLE');
  }

  async function json(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `HTTP ${response.status}`);
      error.code = body?.error?.code;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function loadData() {
    const slug = encodeURIComponent(route.slug);
    const eventResponse = await fetch(`/api/events/${slug}`, { cache: 'no-store' });
    const eventBody = await json(eventResponse);
    if (eventBody.event.status === 'Próximamente') {
      return { event: eventBody.event, state: View.previewCompetitionState(eventBody.event.officialFormat), draft: null };
    }

    const [stateResponse, draftResponse] = await Promise.all([
      fetch(`/api/events/${slug}/competition-teams`, { cache: 'no-store' }),
      fetch(`/api/events/${slug}/draft`, { cache: 'no-store' })
    ]);
    const state = await json(stateResponse);
    const draft = draftResponse.ok ? await draftResponse.json() : null;
    return { event: eventBody.event, state, draft };
  }

  function buildNavigation() {
    const nav = byId('competition-nav');
    nav.replaceChildren(...View.navItems(route.slug).map((item) => {
      const anchor = document.createElement('a');
      anchor.href = item.href;
      anchor.textContent = item.label;
      const active = item.name === route.name || item.matches?.includes(route.name);
      if (active) { anchor.classList.add('active'); anchor.setAttribute('aria-current', 'page'); }
      return anchor;
    }));
  }

  function drawStatsDialog(context, series, game) {
    const dialog = byId('competition-stats-dialog');
    const playerNames = new Map((context.state.teams || []).flatMap((team) =>
      (team.members || []).map((member) => [member.participantId, member.displayName])));
    const teamNames = new Map((context.state.teams || []).map((team) => [team.id, team.name]));
    byId('dialog-title').textContent = `${series.teamA?.name || 'Equipo A'} vs ${series.teamB?.name || 'Equipo B'}`;
    byId('dialog-score').textContent = `${game.teamARounds} — ${game.teamBRounds} · ${Renderers.mapName(context, game.mapKey)}`;

    const table = byId('dialog-table');
    const head = document.createElement('thead'); const header = document.createElement('tr');
    ['JUGADOR', 'EQUIPO', 'AGENTE', 'ACS', 'K', 'D', 'A', '+/−', 'ADR', 'HS%', 'KAST', 'FB'].forEach((label) => { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell); });
    head.append(header); const body = document.createElement('tbody');
    [...(game.stats || [])].sort((left, right) => left.teamId - right.teamId || (right.acs || 0) - (left.acs || 0)).forEach((row) => {
      const tr = document.createElement('tr');
      [playerNames.get(row.participantId) || `Jugador ${row.participantId}`, teamNames.get(row.teamId) || '—', row.agent, row.acs, row.kills, row.deaths, row.assists, row.plusMinus, row.adr, row.hsPercent, row.kastPercent, row.firstKills].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.textContent = value === null || value === undefined ? '—' : String(value);
        tr.append(cell);
      });
      body.append(tr);
    });
    table.replaceChildren(head, body);
    dialog.showModal();
  }

  function draw({ event, state, draft }) {
    document.body.dataset.view = route.name;
    document.documentElement.style.setProperty('--event-accent', event.accentColor || '#ff4655');
    byId('competition-event-link').href = `/eventos/${encodeURIComponent(route.slug)}`;
    buildNavigation();

    const context = { route, slug: route.slug, event, state, draft };
    context.openStats = (series, game) => drawStatsDialog(context, series, game);
    const description = Renderers.describe(context);
    byId('competition-eyebrow').textContent = description.eyebrow;
    byId('competition-title').textContent = description.title;
    byId('competition-subtitle').textContent = description.subtitle;
    document.title = `${description.title} · Mini Eventos Jartiland`;

    byId('competition-kpis').replaceChildren(...description.kpis.map(([label, value]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = value;
      item.append(term, detail); return item;
    }));
    byId('competition-content').replaceChildren(Renderers.render(context));
    byId('competition-loading').hidden = true;
    byId('competition-error').hidden = true;
    byId('competition-main').hidden = false;
    document.body.dataset.preview = String(Boolean(state.preview));
    connection(state.preview ? 'loading' : 'live', state.preview
      ? 'PRÓXIMAMENTE'
      : state.playoffs?.status === 'IN_PROGRESS' || !state.complete ? 'EN DIRECTO' : 'ACTUALIZADO');
  }

  async function refresh() {
    if (refreshPending) return;
    refreshPending = true;
    try { draw(await loadData()); }
    catch (error) {
      showError(error.code === 'EVENT_NOT_FOUND' ? 'Competición no encontrada' : 'No se pudo cargar',
        error.message || 'Inténtalo de nuevo en unos segundos.');
    } finally { refreshPending = false; }
  }

  function connectStream() {
    if (!window.EventSource || !route.slug || document.body.dataset.preview === 'true') return;
    stream?.close();
    stream = new EventSource(`/api/events/${encodeURIComponent(route.slug)}/draft/stream`);
    ['connected', 'competition_updated', 'draft_completed', 'draft_configured', 'draft_started', 'pick_made', 'team_updated'].forEach((event) => stream.addEventListener(event, refresh));
    stream.addEventListener('error', () => connection('error', 'RECONECTANDO'));
  }

  byId('dialog-close').addEventListener('click', () => byId('competition-stats-dialog').close());
  byId('competition-stats-dialog').addEventListener('click', (event) => {
    if (event.target === byId('competition-stats-dialog')) byId('competition-stats-dialog').close();
  });
  window.addEventListener('beforeunload', () => stream?.close());

  if (!route.slug) showError('Ruta incorrecta', 'No se ha indicado qué evento quieres consultar.');
  else refresh().then(connectStream);
})();
