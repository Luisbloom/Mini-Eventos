(function exposeCompetitionRenderers(root, factory) {
  root.CompetitionRenderers = factory(root.CompetitionView);
}(typeof globalThis !== 'undefined' ? globalThis : this, (View) => {
  'use strict';

  const STATUS = {
    COMPLETED: 'Finalizado',
    READY: 'Listo',
    WAITING_RESULT: 'En juego',
    PENDING: 'Pendiente',
    NOT_NEEDED: 'No necesario',
    ACTIVE: 'En directo',
    PAUSED: 'Pausado'
  };
  const METRICS = {
    overall: ['Global', 'Índice global de rendimiento'],
    acs: ['ACS', 'Puntuación media de combate'],
    kills: ['Kills', 'Bajas totales'],
    deaths: ['Deaths', 'Muertes totales (menos es mejor)'],
    assists: ['Asistencias', 'Asistencias totales'],
    kd: ['K/D', 'Ratio de bajas y muertes'],
    firstKills: ['First bloods', 'Primeras bajas']
  };
  const SHORT_DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const DATE_TIME = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function link(href, className, text) {
    const anchor = node('a', className, text);
    anchor.href = href;
    return anchor;
  }

  function competitionRoot(slug) {
    return `/eventos/${encodeURIComponent(slug)}/competicion`;
  }

  function statusLabel(status) {
    return STATUS[status] || String(status || 'Pendiente').replaceAll('_', ' ');
  }

  function playoffStatus(state) {
    if (!state.playoffs?.generated) return 'SIN GENERAR';
    if (state.playoffs.status === 'COMPLETED') return 'TERMINADO';
    if (state.playoffs.series?.some((series) => series.status === 'COMPLETED')) return 'EN JUEGO';
    return 'PUBLICADO';
  }

  function mapName(context, key) {
    return context.state.maps?.find((map) => map.key === key)?.name || key || 'Mapa por confirmar';
  }

  function teamName(team) {
    return team?.name || 'Por determinar';
  }

  function sectionHeader(index, eyebrow, title, copy, action) {
    const header = node('header', 'section-heading');
    const number = node('span', 'section-number', String(index).padStart(2, '0'));
    const words = node('div', 'section-heading-copy');
    words.append(node('p', 'section-label', eyebrow), node('h2', '', title));
    if (copy) words.append(node('p', 'section-copy', copy));
    header.append(number, words);
    if (action) header.append(action);
    return header;
  }

  function badge(text, kind = '') {
    return node('span', `competition-badge${kind ? ` is-${kind}` : ''}`, text);
  }

  function emptyState(title, copy, action) {
    const empty = node('section', 'phase-empty');
    empty.append(node('span', 'phase-empty-mark', '◇'));
    const content = node('div');
    content.append(node('h2', '', title), node('p', '', copy));
    if (action) content.append(action);
    empty.append(content);
    return empty;
  }

  function scoreFor(series) {
    if (series.seriesScore) return `${series.seriesScore.a} — ${series.seriesScore.b}`;
    const game = series.games?.find((item) => item.status === 'COMPLETED');
    return game ? `${game.teamARounds} — ${game.teamBRounds}` : 'VS';
  }

  function seriesCard(context, series, { compact = false } = {}) {
    const card = node('article', `series-card${compact ? ' is-compact' : ''}`);
    card.dataset.status = series.status || 'PENDING';
    const head = node('header');
    const date = series.scheduledAt ? ` · ${SHORT_DATE.format(new Date(series.scheduledAt))}` : '';
    const meta = node('span', 'series-meta', (series.stage === 'PLAYOFFS'
      ? (series.label || `Ronda ${series.matchday || '—'}`)
      : `Jornada ${series.matchday || '—'} · BO${series.bestOf || 1}`) + date);
    const marks = node('span', 'series-marks');
    if (series.games?.some((game) => game.verifiedByCapture)) marks.append(badge('CAPTURA', 'qualified'));
    marks.append(badge(statusLabel(series.status), series.status === 'COMPLETED' ? 'done' : 'pending'));
    head.append(meta, marks);

    const matchup = node('div', 'series-matchup');
    const side = (team, winner) => {
      const row = node('div', `series-team${winner ? ' is-winner' : ''}`);
      row.append(node('strong', '', teamName(team)), node('span', '', winner ? 'GANADOR' : ''));
      return row;
    };
    matchup.append(
      side(series.teamA, series.winnerTeamId && series.teamA?.teamId === series.winnerTeamId),
      node('b', 'series-score', scoreFor(series)),
      side(series.teamB, series.winnerTeamId && series.teamB?.teamId === series.winnerTeamId)
    );
    card.append(head, matchup);

    if (!compact && series.games?.length) {
      const games = node('ol', 'series-games');
      for (const game of series.games) {
        if (game.status === 'NOT_NEEDED') continue;
        const item = node('li');
        item.append(
          node('span', '', `MAPA ${game.gameNumber} · ${mapName(context, game.mapKey)}`),
          node('strong', '', game.status === 'COMPLETED'
            ? `${game.teamARounds} — ${game.teamBRounds}` : statusLabel(game.status))
        );
        if (game.stats?.length && context.openStats) {
          const button = node('button', 'inline-action', 'VER DATOS');
          button.type = 'button';
          button.addEventListener('click', () => context.openStats(series, game));
          item.append(button);
        }
        games.append(item);
      }
      card.append(games);
    }

    const detail = link(`${competitionRoot(context.slug)}/partidos/${series.id}`, 'series-detail-link', 'Abrir detalle →');
    card.append(detail);
    return card;
  }

  function standingsTable(context, rows = context.state.standings || [], { limit = null } = {}) {
    const wrap = node('div', 'competition-table-scroll');
    const table = node('table', 'competition-table standings-table');
    const head = node('thead');
    const header = node('tr');
    ['POS', 'EQUIPO', 'PJ', 'V', 'D', 'RF', 'RC', '+/−', 'ESTADO'].forEach((label) => {
      const cell = node('th', '', label); cell.scope = 'col'; header.append(cell);
    });
    head.append(header);
    const body = node('tbody');
    for (const row of (limit ? rows.slice(0, limit) : rows)) {
      const tr = node('tr', row.qualified ? 'is-qualified' : '');
      const position = node('th', 'position-cell', String(row.position).padStart(2, '0'));
      position.scope = 'row';
      tr.append(
        position,
        node('td', 'team-name-cell', row.name || teamName(context.state.teams?.find((team) => team.id === row.teamId))),
        node('td', '', row.played), node('td', '', row.wins), node('td', '', row.losses),
        node('td', '', row.roundsFor), node('td', '', row.roundsAgainst),
        node('td', row.roundDiff > 0 ? 'is-positive' : row.roundDiff < 0 ? 'is-negative' : '', row.roundDiff > 0 ? `+${row.roundDiff}` : row.roundDiff)
      );
      const stateCell = node('td');
      stateCell.append(row.tieRequiresAdmin
        ? badge('DESEMPATE', 'warning')
        : row.qualified === true ? badge('TOP 4', 'qualified')
          : row.qualified === false ? badge('FUERA', 'muted') : badge('EN JUEGO', 'pending'));
      tr.append(stateCell);
      body.append(tr);
    }
    table.append(head, body); wrap.append(table); return wrap;
  }

  function recordCards(context) {
    const cards = node('div', 'team-performance-grid');
    (context.state.standings || []).forEach((row) => {
      const card = node('article');
      card.append(
        node('span', '', `#${row.position}`),
        node('h3', '', row.name),
        node('strong', '', `${row.wins} — ${row.losses}`),
        node('p', '', `${row.roundsFor} rondas a favor · ${row.roundDiff > 0 ? '+' : ''}${row.roundDiff} diferencial`)
      );
      cards.append(card);
    });
    return cards;
  }

  function progressBar(value, max, label) {
    const safeMax = Math.max(1, Number(max) || 1);
    const progress = Math.min(100, Math.round((Number(value) || 0) / safeMax * 100));
    const block = node('div', 'progress-block');
    const head = node('div');
    head.append(node('span', '', label), node('strong', '', `${value} / ${max}`));
    const track = node('div', 'progress-track');
    const fill = node('span'); fill.style.width = `${progress}%`; track.append(fill);
    block.append(head, track); return block;
  }

  function phaseCard(context, item) {
    const card = link(item.href, `phase-card phase-${item.accent}`, '');
    card.append(
      node('span', 'phase-card-number', item.number),
      badge(item.status, item.ready ? 'done' : 'pending'),
      node('h3', '', item.title),
      node('p', '', item.copy),
      node('strong', 'phase-card-cta', `${item.cta || 'ABRIR'} →`)
    );
    return card;
  }

  function describe(context) {
    const { route, event, state, draft } = context;
    const format = state.format || event.officialFormat;
    const descriptions = {
      hub: ['CENTRO DE COMPETICIÓN', event.name, 'Todo el torneo, bien separado. Entra directamente en la fase, jornada o ranking que buscas.'],
      regular: ['FASE REGULAR', 'Todos contra todos', 'Una lectura rápida de la liga antes de entrar en la tabla completa o en cada jornada.'],
      standings: ['FASE REGULAR · CLASIFICACIÓN', 'La tabla', 'Victorias, desempates y seeding del 1º al 4º. Todos entran en playoffs.'],
      matchdays: ['FASE REGULAR · JORNADAS', 'El calendario', 'Cada bloque cuenta una jornada. Abre cualquiera para ver sus cruces y mapas.'],
      matchday: [`FASE REGULAR · JORNADA ${route.parameter || '—'}`, `Jornada ${route.parameter || '—'}`, 'Todos los cruces de esta jornada en una única vista.'],
      playoffs: ['ELIMINATORIAS', 'El cuadro final', 'Doble eliminación. El recorrido hacia la gran final, ronda a ronda.'],
      stats: ['DATOS DEL TORNEO', 'Estadísticas', 'Compara rendimiento individual y filtra por equipo o métrica.'],
      results: ['MARCADOR OFICIAL', 'Resultados', 'Partidos cerrados, mapas jugados y acceso directo a cada ficha.'],
      match: ['DETALLE DE SERIE', 'Partido', 'Marcador, mapas y estadísticas confirmadas de esta serie.']
    };
    const [eyebrow, title, subtitle] = descriptions[route.name] || descriptions.hub;
    const teamCount = state.teams?.length || draft?.teams?.length || format?.teams || 0;
    const playerCount = state.playerStats?.length || format?.players || 0;
    const kpis = route.name === 'stats'
      ? [['JUGADORES', playerCount], ['EQUIPOS', teamCount], ['MAPAS', state.seriesPlayed || 0]]
      : route.name === 'playoffs'
        ? [['ESTADO', playoffStatus(state)], ['EQUIPOS', format?.playoffs?.teams || teamCount], ['FORMATO', 'DOBLE ELIM.']]
        : route.name === 'hub'
          ? [['ESTADO', event.status], ['FORMATO', `${teamCount} × ${format?.teamSize || 5}`], ['LIGA', `${state.seriesPlayed || 0}/${state.seriesTotal || format?.regularSeason?.series || 0}`], ['PLAYOFFS', 'TODOS CLASIFICAN']]
          : [['ESTADO', event.status], ['EQUIPOS', teamCount], ['PARTIDOS', `${state.seriesPlayed || 0}/${state.seriesTotal || format?.regularSeason?.series || 0}`]];
    return { eyebrow, title, subtitle, kpis };
  }

  function renderHub(context) {
    const root = competitionRoot(context.slug);
    const upcoming = Boolean(context.state.preview);
    const format = context.state.format || context.event.officialFormat;
    const container = node('div', 'hub-layout');
    const next = View.nextSeries(context.state);
    const spotlight = node('section', 'hub-spotlight');
    const overview = node('article', 'hub-overview');
    const official = Boolean(format);
    /*
      Que el evento esté abierto no significa que la competición haya empezado.

      Entre abrir inscripciones y hacer el draft no hay ni equipos ni calendario,
      y aquí se anunciaba «La competición está en marcha» con la tabla vacía
      debajo. Empezada es cuando hay equipos o series, no cuando hay evento.
    */
    const empezada = (context.state.teams?.length || 0) > 0
      || (context.state.seriesTotal || 0) > 0;
    overview.append(
      node('p', 'section-label', 'ESTADO DEL TORNEO'),
      node('h2', '', upcoming
        ? 'Próximamente'
        : !empezada
          ? 'Todavía no ha empezado'
          : context.state.complete
            ? official ? 'Seeding confirmado' : 'La liga ya tiene Top 4'
            : 'La competición está en marcha'),
      node('p', 'section-copy', upcoming
        ? `${format?.players || 20} jugadores formarán ${format?.teams || 4} equipos. La liga ordenará el seeding y todos entrarán en el cuadro de doble eliminación.`
        : !empezada
        ? `Las inscripciones siguen abiertas. Cuando se cierren, ${format?.players || 20} jugadores formarán ${format?.teams || 4} equipos en el draft y aquí aparecerán el calendario y la clasificación.`
        : context.state.complete
        ? 'La fase regular está cerrada. El foco pasa al cuadro de doble eliminación.'
        : 'Sigue el calendario y mira cómo cambia la clasificación con cada resultado.'),
      progressBar(context.state.seriesPlayed || 0, context.state.seriesTotal || 0, 'FASE REGULAR')
    );
    const nextCard = node('article', 'hub-next');
    nextCard.append(node('p', 'section-label', next ? 'SIGUIENTE SERIE' : 'ÚLTIMA ACTUALIZACIÓN'));
    if (next) {
      nextCard.append(
        badge(next.stage === 'PLAYOFFS' ? 'PLAYOFFS' : `JORNADA ${next.matchday}`, 'live'),
        node('h2', '', `${teamName(next.teamA)} vs ${teamName(next.teamB)}`),
        node('p', 'section-copy', `${next.label || `BO${next.bestOf || 1}`} · ${statusLabel(next.status)}`),
        link(`${root}/partidos/${next.id}`, 'primary-cta', 'VER PARTIDO →')
      );
    } else {
      nextCard.append(node('h2', '', 'Todo al día'), node('p', 'section-copy', 'No hay ninguna serie pendiente con participantes confirmados.'));
    }
    spotlight.append(overview, nextCard); container.append(spotlight);

    const phases = node('section', 'hub-section');
    phases.append(sectionHeader(1, 'NAVEGACIÓN', 'Elige tu vista', 'Cada apartado tiene ahora su propia página y una sola función.'));
    const cards = node('div', 'phase-grid is-minimal');
    [
      { number: '01', title: 'Draft', copy: upcoming ? `${format?.captains || 4} capitanes · ${format?.draftPicks || 16} elecciones` : `${context.draft?.teams?.length || 0} equipos · ${statusLabel(context.draft?.status)}`, status: upcoming ? 'PRÓXIMAMENTE' : statusLabel(context.draft?.status), ready: context.draft?.status === 'COMPLETED', href: `${root}/draft`, accent: 'draft' },
      { number: '02', title: 'Fase regular', copy: upcoming ? `${format?.regularSeason?.matchdays || 3} jornadas · ${format?.regularSeason?.series || 6} BO1` : `${context.state.seriesPlayed || 0} de ${context.state.seriesTotal || 0} partidos`, status: upcoming ? 'TODOS CONTRA TODOS' : context.state.complete ? 'TERMINADA' : 'EN JUEGO', ready: context.state.generated, href: `${root}/fase-regular`, accent: 'league' },
      { number: '03', title: 'Playoffs', copy: '1º–4º · 2º–3º · cuadro alto y bajo', status: upcoming ? 'DOBLE ELIMINACIÓN' : playoffStatus(context.state), ready: context.state.playoffs?.generated, href: `${root}/playoffs`, accent: 'playoffs' }
    ].forEach((item) => cards.append(phaseCard(context, item)));
    phases.append(cards); container.append(phases);
    return container;
  }

  function renderRegular(context) {
    const root = competitionRoot(context.slug);
    if (context.state.preview) {
      const format = context.state.format || context.event.officialFormat;
      const section = node('section', 'content-section');
      section.append(sectionHeader(1, 'FORMATO OFICIAL', 'Todos contra todos', `${format.regularSeason.matchdays} jornadas · ${format.regularSeason.series} series · BO${format.regularSeason.bestOf}`));
      section.append(node('p', 'competition-notice', 'Cada equipo jugará una vez contra sus tres rivales. Nadie queda eliminado: los cuatro equipos avanzan y la tabla sólo decide el seeding.'));
      const days = node('div', 'matchday-grid');
      for (let day = 1; day <= format.regularSeason.matchdays; day += 1) {
        const card = node('article', 'matchday-card is-preview');
        card.append(node('span', 'matchday-index', String(day).padStart(2, '0')), node('h2', '', `Jornada ${day}`), node('p', 'section-copy', `${format.regularSeason.matchesPerMatchday} cruces · equipos por determinar`));
        days.append(card);
      }
      section.append(days); return section;
    }
    if (!context.state.generated) return emptyState('La liga todavía no está generada', 'Cuando termine el draft, las jornadas y la tabla aparecerán aquí.', link(`${root}/draft`, 'primary-cta', 'VER DRAFT →'));
    const layout = node('div', 'page-stack');
    const summary = node('section', 'regular-summary is-compact');
    const progress = node('article', 'regular-progress-card');
    progress.append(node('p', 'section-label', 'PROGRESO'), node('h2', '', context.state.complete ? 'Fase cerrada' : 'Liga en juego'), progressBar(context.state.seriesPlayed, context.state.seriesTotal, 'PARTIDOS DISPUTADOS'));
    summary.append(progress); layout.append(summary);
    const tableSection = node('section', 'content-section');
    tableSection.append(sectionHeader(2, 'CLASIFICACIÓN', 'Seeding de la liga', 'Todos avanzan; la posición decide los cruces.'), standingsTable(context, context.state.standings));
    layout.append(tableSection);
    if (context.state.matchdays?.length) {
      const days = node('section', 'content-section');
      days.append(sectionHeader(3, 'CALENDARIO', 'Jornadas', 'Todos los cruces y marcadores de la fase regular.'));
      const grid = node('div', 'matchday-grid');
      context.state.matchdays.forEach((day) => grid.append(matchdaySummary(context, day)));
      days.append(grid); layout.append(days);
    }
    const secondary = node('nav', 'competition-secondary-links');
    secondary.setAttribute('aria-label', 'Datos de la fase regular');
    secondary.append(link(`${root}/estadisticas`, '', 'RANKING DE JUGADORES →'), link(`${root}/resultados`, '', 'TODOS LOS RESULTADOS →'));
    layout.append(secondary);
    return layout;
  }

  function renderStandings(context) {
    if (context.state.preview) return emptyState('Clasificación próximamente', 'Los cuatro equipos se ordenarán del 1º al 4º. Todos entran en playoffs; las victorias y los desempates deportivos decidirán el seeding.');
    if (!context.state.standings?.length) return emptyState('Sin clasificación', 'La tabla se calculará en cuanto exista la fase regular.');
    const section = node('section', 'content-section');
    section.append(sectionHeader(1, 'TABLA COMPLETA', 'Clasificación', 'Las victorias mandan. Los desempates usan enfrentamiento directo y diferencia de rondas.'));
    if (context.state.tieRequiresAdmin) section.append(node('p', 'competition-notice is-warning', 'Hay un empate que necesita resolución de la organización.'));
    section.append(standingsTable(context));
    const legend = node('div', 'table-legend');
    legend.append(badge('1º–4º', 'qualified'), node('span', '', 'Todos clasifican a playoffs'), badge('DESEMPATE', 'warning'), node('span', '', 'Orden pendiente de decisión'));
    section.append(legend); return section;
  }

  function matchdaySummary(context, day) {
    const card = link(`${competitionRoot(context.slug)}/fase-regular/jornadas/${day.matchday}`, 'matchday-card', '');
    const completed = day.series.filter((series) => series.status === 'COMPLETED').length;
    const head = node('header');
    head.append(node('span', 'matchday-index', String(day.matchday).padStart(2, '0')), badge(completed === day.series.length ? 'FINALIZADA' : `${completed}/${day.series.length}`, completed === day.series.length ? 'done' : 'pending'));
    card.append(head, node('h2', '', `Jornada ${day.matchday}`));
    const matches = node('ul', 'matchday-preview');
    for (const series of day.series) {
      const item = node('li');
      item.append(node('span', '', teamName(series.teamA)), node('b', '', scoreFor(series)), node('span', '', teamName(series.teamB)));
      matches.append(item);
    }
    card.append(matches, node('strong', 'phase-card-cta', 'ABRIR JORNADA →')); return card;
  }

  function renderMatchdays(context) {
    if (context.state.preview) {
      const section = node('section', 'content-section');
      section.append(sectionHeader(1, 'CALENDARIO OFICIAL', 'Tres jornadas', 'Dos enfrentamientos por jornada. Los equipos concretos se publicarán tras el draft.'));
      const grid = node('div', 'matchday-grid');
      for (let day = 1; day <= 3; day += 1) grid.append(phaseCard(context, { number: String(day).padStart(2, '0'), title: `Jornada ${day}`, copy: 'Dos cruces · equipos por determinar', status: 'POR ANUNCIAR', href: '#', accent: 'calendar', cta: 'PENDIENTE' }));
      section.append(grid); return section;
    }
    if (!context.state.matchdays?.length) return emptyState('Calendario pendiente', 'Las jornadas se publicarán al generar la fase regular.');
    const section = node('section', 'content-section');
    section.append(sectionHeader(1, 'CALENDARIO', 'Todas las jornadas', 'Un bloque por jornada. Entra para ver mapas y detalles.'));
    const grid = node('div', 'matchday-grid');
    context.state.matchdays.forEach((day) => grid.append(matchdaySummary(context, day)));
    section.append(grid); return section;
  }

  function renderMatchday(context) {
    const day = context.state.matchdays?.find((item) => Number(item.matchday) === Number(context.route.parameter));
    if (!day) return emptyState('Jornada no encontrada', 'No existe esa jornada en el calendario publicado.', link(`${competitionRoot(context.slug)}/fase-regular/jornadas`, 'primary-cta', 'VER TODAS →'));
    const section = node('section', 'content-section');
    const back = link(`${competitionRoot(context.slug)}/fase-regular/jornadas`, 'text-cta', '← TODAS LAS JORNADAS');
    section.append(sectionHeader(day.matchday, 'FASE REGULAR', `Jornada ${day.matchday}`, `${day.series.length} cruces · ${day.series.filter((series) => series.status === 'COMPLETED').length} finalizados`, back));
    const grid = node('div', 'series-grid is-detail');
    day.series.forEach((series) => grid.append(seriesCard(context, { ...series, stage: 'REGULAR', matchday: day.matchday })));
    section.append(grid); return section;
  }

  function renderPlayoffs(context) {
    if (context.state.preview) {
      const section = node('section', 'content-section bracket-section');
      section.append(sectionHeader(1, 'DOBLE ELIMINACIÓN', 'Playoffs próximamente', 'Los cuatro equipos entran. La primera derrota baja al cuadro inferior y la segunda elimina.'));
      const grid = node('div', 'regular-route-grid');
      grid.append(
        phaseCard(context, { number: 'A', title: '1º vs 4º', copy: 'Primera semifinal del cuadro alto.', status: 'BO3', href: '#', accent: 'playoffs', cta: 'POR DETERMINAR' }),
        phaseCard(context, { number: 'B', title: '2º vs 3º', copy: 'Segunda semifinal del cuadro alto.', status: 'BO3', href: '#', accent: 'playoffs', cta: 'POR DETERMINAR' })
      );
      section.append(grid, node('p', 'competition-notice', 'La Gran Final será BO3 por defecto. Si el equipo del cuadro inferior vence al equipo invicto, se jugará una Gran Final de reset.'));
      return section;
    }
    if (!context.state.playoffs?.generated) return emptyState('El cuadro todavía no está generado', context.state.complete ? (context.event.officialFormat ? 'La liga ya ha terminado. La organización publicará los cruces 1º–4º y 2º–3º.' : 'La liga ya ha terminado. La organización publicará los cruces del Top 4.') : 'Primero deben terminar todos los partidos de la fase regular.', link(`${competitionRoot(context.slug)}/fase-regular/clasificacion`, 'primary-cta', 'VER CLASIFICACIÓN →'));
    const section = node('section', 'content-section bracket-section');
    section.append(sectionHeader(1, 'DOBLE ELIMINACIÓN', 'Camino a la final', 'Dos derrotas eliminan. El cuadro alto y el bajo convergen en la gran final.'));
    const bracket = node('div', 'competition-bracket');
    const zones = [['UPPER', 'Cuadro alto'], ['LOWER', 'Cuadro bajo'], ['GRAND', 'Gran final']];
    for (const [key, title] of zones) {
      const zone = node('section', `bracket-zone zone-${key.toLowerCase()}`);
      zone.append(node('header', '', title));
      context.state.playoffs.series.filter((series) => series.bracket === key).forEach((series) => zone.append(seriesCard(context, { ...series, stage: 'PLAYOFFS' })));
      bracket.append(zone);
    }
    section.append(bracket);
    const confirmedPlacements = View.confirmedPlacements(context.state.playoffs.placements);
    if (confirmedPlacements.length) {
      const placements = node('section', 'placements-panel');
      placements.append(node('p', 'section-label', 'PUESTOS CONFIRMADOS'));
      const list = node('ol');
      confirmedPlacements.forEach((place) => {
        const item = node('li'); item.append(node('b', '', `#${place.position}`), node('span', '', place.name || `Equipo ${place.teamId}`)); list.append(item);
      });
      placements.append(list); section.append(placements);
    }
    const secondary = node('nav', 'competition-secondary-links');
    secondary.setAttribute('aria-label', 'Resultados de playoffs');
    secondary.append(link(`${competitionRoot(context.slug)}/resultados`, '', 'TODOS LOS RESULTADOS →'));
    section.append(secondary);
    return section;
  }

  function playerNameMap(context) {
    return new Map((context.state.teams || []).flatMap((team) =>
      (team.members || []).map((member) => [member.participantId, member.displayName])));
  }

  function renderStatsTable(context, rows, metric) {
    const names = playerNameMap(context);
    const teams = new Map((context.state.teams || []).map((team) => [team.id, team.name]));
    const wrap = node('div', 'competition-table-scroll');
    const table = node('table', 'competition-table player-ranking-table');
    const head = node('thead'); const header = node('tr');
    ['#', 'JUGADOR', 'EQUIPO', 'PJ', 'GLOBAL', 'ACS', 'K', 'D', 'A', 'K/D', 'ADR', 'HS%', 'KAST', 'FB'].forEach((label) => { const cell = node('th', '', label); cell.scope = 'col'; header.append(cell); });
    head.append(header); const body = node('tbody');
    rows.forEach((row, index) => {
      const tr = node('tr', index < 3 ? 'is-top-player' : '');
      const position = node('th', 'position-cell', String(index + 1).padStart(2, '0')); position.scope = 'row';
      const value = (field) => row[field] === null || row[field] === undefined ? '—' : row[field];
      tr.append(position, node('td', 'team-name-cell', names.get(row.participantId) || `Jugador ${row.participantId}`), node('td', '', teams.get(row.teamId) || '—'), node('td', '', value('games')), node('td', metric === 'overall' ? 'is-highlight global-score-cell' : 'global-score-cell', value('globalScore')), node('td', metric === 'acs' ? 'is-highlight' : '', value('acs')), node('td', metric === 'kills' ? 'is-highlight' : '', value('kills')), node('td', '', value('deaths')), node('td', metric === 'assists' ? 'is-highlight' : '', value('assists')), node('td', metric === 'kd' ? 'is-highlight' : '', value('kd')), node('td', '', value('adr')), node('td', '', value('hsPercent')), node('td', '', value('kastPercent')), node('td', metric === 'firstKills' ? 'is-highlight' : '', value('firstKills')));
      body.append(tr);
    });
    table.append(head, body); wrap.append(table); return wrap;
  }

  function renderStats(context) {
    const rawStats = context.state.playerStats || [];
    if (!rawStats.length) return emptyState('Todavía no hay estadísticas', context.state.preview ? 'Las estadísticas aparecerán cuando comiencen los partidos.' : 'Aparecerán cuando existan partidas con datos de jugadores confirmados.');
    const stats = View.scoreGlobalPlayers(rawStats);
    const section = node('section', 'content-section stats-section');
    section.append(sectionHeader(1, 'CLASIFICACIÓN INDIVIDUAL', 'Ranking global de jugadores', 'Una lectura conjunta del rendimiento confirmado durante todo el torneo.'));
    const formula = node('aside', 'global-ranking-note');
    formula.append(node('strong', '', 'ÍNDICE GLOBAL · 0–100'), node('p', '', 'Combina todas las fases y ACS, K/D, ADR, KAST, kills, deaths, asistencias, headshots y primeras bajas y muertes. Compara promedios por partida, pondera la muestra real y los datos ausentes no suman.'));
    section.append(formula);
    const controls = node('form', 'stats-controls'); controls.addEventListener('submit', (event) => event.preventDefault());
    const searchLabel = node('label'); searchLabel.append(node('span', '', 'BUSCAR JUGADOR'));
    const search = node('input'); search.type = 'search'; search.name = 'q'; search.autocomplete = 'off'; search.placeholder = 'Nombre del jugador…'; searchLabel.append(search);
    const metricLabel = node('label'); metricLabel.append(node('span', '', 'ORDENAR POR'));
    const metric = node('select'); metric.name = 'metric'; Object.entries(METRICS).forEach(([key, [label]]) => { const option = node('option', '', label); option.value = key; metric.append(option); }); metricLabel.append(metric);
    const teamLabel = node('label'); teamLabel.append(node('span', '', 'EQUIPO'));
    const team = node('select'); team.name = 'team'; const all = node('option', '', 'Todos los equipos'); all.value = ''; team.append(all);
    (context.state.teams || []).forEach((item) => { const option = node('option', '', item.name); option.value = item.id; team.append(option); }); teamLabel.append(team);
    const query = new URLSearchParams(window.location.search);
    search.value = query.get('q') || '';
    if (METRICS[query.get('metric')]) metric.value = query.get('metric');
    if ([...team.options].some((option) => option.value === query.get('team'))) team.value = query.get('team');
    controls.append(searchLabel, metricLabel, teamLabel); section.append(controls);
    const podium = node('div', 'stats-podium');
    const tableTarget = node('div');
    const repaint = () => {
      const names = playerNameMap(context);
      const normalizedSearch = search.value.trim().toLocaleLowerCase('es');
      const metricField = metric.value === 'overall' ? 'globalScore' : metric.value;
      const rows = View.rankPlayers(stats.filter((row) => (!team.value || Number(team.value) === row.teamId) && (!normalizedSearch || (names.get(row.participantId) || '').toLocaleLowerCase('es').includes(normalizedSearch))), metricField, metric.value === 'deaths' ? 'asc' : 'desc');
      /*
        Los puestos se comparten cuando hay empate en la métrica. Para pintar
        una lista da igual, pero estos tres puestos deciden premios: dar el #1
        a uno de dos empatados por su número interno sería inventar un ganador.
      */
      const conPuesto = View.withRanking(rows, metricField);
      podium.replaceChildren(...conPuesto.slice(0, 3).map((row, index) => {
        const card = node('article', `stat-leader place-${index + 1}`);
        if (row.rankTied) card.classList.add('is-tied');
        const displayedValue = row[metricField] === null || row[metricField] === undefined
          ? '—'
          : `${row[metricField]}${metric.value === 'overall' ? ' / 100' : ''}`;
        card.append(
          node('span', '', `#${row.rankPosition} · ${METRICS[metric.value][0]}`),
          node('strong', '', names.get(row.participantId) || `Jugador ${row.participantId}`),
          node('b', '', displayedValue));
        if (row.rankTied) card.append(node('small', 'tie-note', 'Empatado: lo decide la organización'));
        return card;
      }));
      tableTarget.replaceChildren(renderStatsTable(context, rows, metric.value));
    };
    const update = () => {
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      if (metric.value !== 'overall') params.set('metric', metric.value);
      if (team.value) params.set('team', team.value);
      history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
      repaint();
    };
    [search, metric, team].forEach((control) => control.addEventListener(control === search ? 'input' : 'change', update));
    repaint(); section.append(podium, tableTarget);

    const teamSection = node('section', 'content-section');
    teamSection.append(sectionHeader(2, 'RENDIMIENTO COLECTIVO', 'Datos por equipo', 'El récord de la fase regular contextualiza los rankings individuales.'));
    teamSection.append(recordCards(context)); const stack = node('div', 'page-stack'); stack.append(section, teamSection); return stack;
  }

  function renderResults(context) {
    const completed = View.allSeries(context.state).filter((series) => series.status === 'COMPLETED');
    if (!completed.length) return emptyState('Todavía no hay resultados', context.state.preview ? 'Los marcadores aparecerán cuando comiencen los partidos.' : 'Los partidos cerrados aparecerán aquí, separados del calendario pendiente.');
    const section = node('section', 'content-section results-section');
    section.append(sectionHeader(1, 'HISTORIAL', 'Partidos finalizados', 'Filtra por fase o equipo y abre cualquier serie para ver sus mapas.'));
    const controls = node('form', 'stats-controls results-controls'); controls.addEventListener('submit', (event) => event.preventDefault());
    const stageLabel = node('label'); stageLabel.append(node('span', '', 'FASE'));
    const stage = node('select'); stage.name = 'stage'; [['', 'Todas'], ['REGULAR', 'Fase regular'], ['PLAYOFFS', 'Playoffs']].forEach(([value, label]) => { const option = node('option', '', label); option.value = value; stage.append(option); }); stageLabel.append(stage);
    const teamLabel = node('label'); teamLabel.append(node('span', '', 'EQUIPO'));
    const team = node('select'); team.name = 'team'; const all = node('option', '', 'Todos'); all.value = ''; team.append(all); (context.state.teams || []).forEach((item) => { const option = node('option', '', item.name); option.value = item.id; team.append(option); }); teamLabel.append(team);
    const query = new URLSearchParams(window.location.search);
    if ([...stage.options].some((option) => option.value === query.get('stage'))) stage.value = query.get('stage');
    if ([...team.options].some((option) => option.value === query.get('team'))) team.value = query.get('team');
    controls.append(stageLabel, teamLabel); section.append(controls);
    const target = node('div');
    const repaint = () => {
      const rows = completed.filter((series) => (!stage.value || series.stage === stage.value) && (!team.value || [series.teamA?.teamId, series.teamB?.teamId].includes(Number(team.value))));
      const grid = node('div', 'result-list'); rows.reverse().forEach((series) => grid.append(seriesCard(context, series, { compact: true })));
      target.replaceChildren(grid);
    };
    const update = () => {
      const params = new URLSearchParams();
      if (stage.value) params.set('stage', stage.value);
      if (team.value) params.set('team', team.value);
      history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
      repaint();
    };
    [stage, team].forEach((control) => control.addEventListener('change', update)); repaint(); section.append(target);
    const privacy = node('aside', 'privacy-note'); privacy.append(node('strong', '', 'CAPTURAS PROTEGIDAS'), node('p', '', 'Las capturas originales pueden contener información privada y sólo se consultan en administración. La parte pública muestra únicamente el resultado y las estadísticas confirmadas.'));
    section.append(privacy); return section;
  }

  function renderMatch(context) {
    const series = View.findSeries(context.state, context.route.parameter);
    if (!series) return emptyState('Partido no encontrado', 'La serie no existe o ya no forma parte de esta competición.', link(`${competitionRoot(context.slug)}/resultados`, 'primary-cta', 'VOLVER A RESULTADOS →'));
    const section = node('section', 'content-section match-detail');
    const stage = series.stage === 'PLAYOFFS' ? (series.label || 'Playoffs') : `Fase regular · Jornada ${series.matchday}`;
    const hero = node('article', 'match-scoreboard');
    hero.append(badge(stage.toUpperCase(), series.stage === 'PLAYOFFS' ? 'playoffs' : 'live'));
    const teams = node('div', 'match-scoreboard-teams');
    const side = (team, winner) => { const box = node('div', winner ? 'is-winner' : ''); box.append(node('span', '', winner ? 'GANADOR' : 'EQUIPO'), node('h2', '', teamName(team))); return box; };
    teams.append(side(series.teamA, series.winnerTeamId === series.teamA?.teamId), node('strong', '', scoreFor(series)), side(series.teamB, series.winnerTeamId === series.teamB?.teamId));
    hero.append(teams, node('p', 'match-date', series.scheduledAt ? DATE_TIME.format(new Date(series.scheduledAt)) : 'Fecha y hora por confirmar'));
    section.append(hero);
    const games = node('section', 'match-games'); games.append(sectionHeader(1, 'MAPAS', 'Desglose de la serie', 'Sólo aparecen resultados confirmados.'));
    const grid = node('div', 'series-grid is-detail');
    (series.games || []).filter((game) => game.status !== 'NOT_NEEDED').forEach((game) => {
      const card = node('article', 'map-detail-card');
      card.append(node('span', 'section-label', `MAPA ${game.gameNumber}`), node('h3', '', mapName(context, game.mapKey)), node('strong', 'map-score', game.status === 'COMPLETED' ? `${game.teamARounds} — ${game.teamBRounds}` : statusLabel(game.status)));
      if (game.verifiedByCapture) card.append(badge('VERIFICADO POR CAPTURA', 'qualified'));
      if (game.stats?.length && context.openStats) { const button = node('button', 'primary-cta', 'VER ESTADÍSTICAS'); button.type = 'button'; button.addEventListener('click', () => context.openStats(series, game)); card.append(button); }
      grid.append(card);
    });
    games.append(grid); section.append(games);
    section.append(node('p', 'privacy-note', 'Las imágenes originales de las capturas se mantienen privadas. Aquí sólo se publica la información deportiva confirmada.'));
    return section;
  }

  const renderers = {
    hub: renderHub,
    regular: renderRegular,
    standings: renderStandings,
    matchdays: renderMatchdays,
    matchday: renderMatchday,
    playoffs: renderPlayoffs,
    stats: renderStats,
    results: renderResults,
    match: renderMatch
  };

  return {
    METRICS,
    describe,
    render(context) { return (renderers[context.route.name] || renderHub)(context); },
    statusLabel,
    mapName,
    node
  };
})) ;
