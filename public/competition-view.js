(function exposeCompetitionView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CompetitionView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };

  function routeFor(pathname) {
    const parts = String(pathname || '').split('/').filter(Boolean).map(decode);
    const eventIndex = parts.indexOf('eventos');
    const slug = eventIndex >= 0 ? parts[eventIndex + 1] || '' : '';
    const competitionIndex = parts.indexOf('competicion', eventIndex + 2);
    const rest = competitionIndex >= 0 ? parts.slice(competitionIndex + 1) : [];

    if (!rest.length) return { name: 'hub', slug, parameter: null };
    if (rest[0] === 'draft') return { name: 'draft', slug, parameter: null };
    if (rest[0] === 'playoffs') return { name: 'playoffs', slug, parameter: null };
    if (rest[0] === 'estadisticas') return { name: 'stats', slug, parameter: null };
    if (rest[0] === 'resultados') return { name: 'results', slug, parameter: null };
    if (rest[0] === 'partidos') {
      return { name: 'match', slug, parameter: Number(rest[1]) || null };
    }
    if (rest[0] === 'fase-regular') {
      if (rest[1] === 'clasificacion') return { name: 'standings', slug, parameter: null };
      if (rest[1] === 'jornadas' && rest[2]) {
        return { name: 'matchday', slug, parameter: Number(rest[2]) || null };
      }
      if (rest[1] === 'jornadas') return { name: 'matchdays', slug, parameter: null };
      return { name: 'regular', slug, parameter: null };
    }
    return { name: 'hub', slug, parameter: null };
  }

  function base(slug) {
    return `/eventos/${encodeURIComponent(slug)}/competicion`;
  }

  function navItems(slug) {
    const root = base(slug);
    return [
      { name: 'hub', label: 'Resumen', href: root },
      { name: 'draft', label: 'Draft', href: `${root}/draft` },
      { name: 'regular', label: 'Fase regular', href: `${root}/fase-regular`, matches: ['standings', 'matchdays', 'matchday'] },
      { name: 'playoffs', label: 'Playoffs', href: `${root}/playoffs` },
      { name: 'stats', label: 'Estadísticas', href: `${root}/estadisticas` },
      { name: 'results', label: 'Resultados', href: `${root}/resultados`, matches: ['match'] }
    ];
  }

  function flattenRegularSeries(state = {}) {
    return (state.matchdays || []).flatMap((matchday) =>
      (matchday.series || []).map((series) => ({
        ...series,
        stage: 'REGULAR',
        matchday: matchday.matchday
      })));
  }

  function playoffSeries(state = {}) {
    return (state.playoffs?.series || []).map((series) => ({
      ...series,
      stage: 'PLAYOFFS',
      matchday: series.round
    }));
  }

  function allSeries(state = {}) {
    return [...flattenRegularSeries(state), ...playoffSeries(state)];
  }

  function findSeries(state, id) {
    const wanted = Number(id);
    return allSeries(state).find((series) => Number(series.id) === wanted) || null;
  }

  function nextSeries(state = {}) {
    return allSeries(state).find((series) =>
      series.status !== 'COMPLETED'
      && series.status !== 'NOT_NEEDED'
      && series.teamA?.teamId
      && series.teamB?.teamId) || null;
  }

  function rankPlayers(rows = [], metric = 'acs', direction = 'desc') {
    return [...rows].sort((left, right) => {
      const leftValue = left?.[metric];
      const rightValue = right?.[metric];
      const a = Number(leftValue);
      const b = Number(rightValue);
      const hasA = leftValue !== null && leftValue !== undefined && leftValue !== '' && Number.isFinite(a);
      const hasB = rightValue !== null && rightValue !== undefined && rightValue !== '' && Number.isFinite(b);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (hasA && a !== b) return direction === 'asc' ? a - b : b - a;
      return (Number(right?.kills) || 0) - (Number(left?.kills) || 0)
        || Number(left?.participantId) - Number(right?.participantId);
    });
  }

  /** Estado deliberadamente vacío para anunciar la competición sin filtrar su preparación. */
  function previewCompetitionState(format = null) {
    return {
      preview: true,
      format,
      generated: false,
      complete: false,
      teams: [],
      standings: [],
      matchdays: [],
      playerStats: [],
      maps: [],
      veto: format?.veto ?? { status: 'VETO_NOT_CONFIGURED', mapPool: null, rules: { bo1: null, bo3: null } },
      seriesPlayed: 0,
      seriesTotal: format?.regularSeason?.series ?? 0,
      playoffs: { generated: false, status: 'PENDING', series: [], placements: [] }
    };
  }

  return {
    routeFor,
    navItems,
    flattenRegularSeries,
    playoffSeries,
    allSeries,
    findSeries,
    nextSeries,
    rankPlayers,
    previewCompetitionState
  };
}));
