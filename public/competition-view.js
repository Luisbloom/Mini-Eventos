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
      { name: 'playoffs', label: 'Playoffs', href: `${root}/playoffs`, matches: ['results', 'match'] },
      { name: 'stats', label: 'Ranking', href: `${root}/estadisticas` }
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

  /**
   * Índice global relativo (0–100). Normaliza cada métrica contra el resto del
   * torneo, usa promedios por partida para los acumulados y reduce el peso de
   * muestras pequeñas. No modifica las filas recibidas.
   */
  function scoreGlobalPlayers(rows = []) {
    const sampleSize = (row, field) => {
      const explicit = row?.sampleSizes?.[field];
      return Number.isFinite(Number(explicit)) ? Number(explicit) : Number(row?.games) || 0;
    };
    const perGame = (field) => (row) => {
      const samples = sampleSize(row, field);
      const value = row?.[field];
      return samples > 0 && value !== null && value !== undefined && value !== ''
        ? Number(value) / samples
        : null;
    };
    const direct = (field) => (row) => row?.[field];
    const metrics = [
      { field: 'acs', read: direct('acs'), weight: 22 },
      { field: 'kd', read: direct('kd'), weight: 18 },
      { field: 'adr', read: direct('adr'), weight: 12 },
      { field: 'kastPercent', read: direct('kastPercent'), weight: 12 },
      { field: 'kills', read: perGame('kills'), weight: 10 },
      { field: 'deaths', read: perGame('deaths'), weight: 8, lowerIsBetter: true },
      { field: 'assists', read: perGame('assists'), weight: 6 },
      { field: 'firstKills', read: perGame('firstKills'), weight: 5 },
      { field: 'hsPercent', read: direct('hsPercent'), weight: 4 },
      { field: 'firstDeaths', read: perGame('firstDeaths'), weight: 3, lowerIsBetter: true }
    ];
    const valid = (value) => value !== null && value !== undefined && value !== ''
      && Number.isFinite(Number(value));
    const ranges = metrics.map((metric) => {
      const values = rows.map(metric.read).filter(valid).map(Number);
      return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
    });
    const activeWeight = metrics.reduce((total, metric, index) => total + (ranges[index] ? metric.weight : 0), 0);
    const maxGames = Math.max(1, ...rows.map((row) => Number(row?.games) || 0));

    return rows.map((row) => {
      let score = 0;
      let coveredWeight = 0;
      metrics.forEach((metric, index) => {
        const value = metric.read(row);
        const range = ranges[index];
        if (!range) return;
        const games = Math.max(1, Number(row?.games) || 0);
        const metricCoverage = Math.min(1, sampleSize(row, metric.field) / games);
        if (!valid(value) || metricCoverage <= 0) return;
        const normalized = range.max === range.min
          ? 0.5
          : (Number(value) - range.min) / (range.max - range.min);
        score += (metric.lowerIsBetter ? 1 - normalized : normalized) * metric.weight * metricCoverage;
        coveredWeight += metric.weight * metricCoverage;
      });
      if (!coveredWeight || !activeWeight) return { ...row, globalScore: null, globalCoverage: 0 };
      // Los datos ausentes no desaparecen del denominador: simplemente no
      // suman. Así nunca mejoran artificialmente la posición de un jugador.
      const performance = score / activeWeight;
      const coverage = coveredWeight / activeWeight;
      const sample = Math.min(1, (Number(row?.games) || 0) / maxGames);
      const reliability = (0.5 + (0.5 * sample)) * (0.8 + (0.2 * coverage));
      return {
        ...row,
        globalScore: Math.round(performance * reliability * 1000) / 10,
        globalCoverage: Math.round(coverage * 100) / 100
      };
    });
  }

  function confirmedPlacements(rows = []) {
    return rows.filter((row) => row?.position !== null
      && row?.position !== undefined
      && row?.position !== ''
      && Number.isFinite(Number(row.position)));
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
    scoreGlobalPlayers,
    confirmedPlacements,
    previewCompetitionState
  };
}));
