(function exposeAmongUsCompetitionView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AmongUsCompetitionView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SECTION_MODULES = ['competition', 'schedule', 'participants', 'matches'];

  function enabledSections(event = {}) {
    return SECTION_MODULES.filter((name) => Boolean(event.modules?.[name]));
  }

  function describeMatch(match = {}, stages = []) {
    const stage = stages.find((item) => Number(item.id) === Number(match.stageId));
    const group = stage?.groups?.find((item) => Number(item.id) === Number(match.groupId));
    const result = match.result || {};
    return {
      title: result.map || result.gameMode || `Partida ${match.id}`,
      context: [stage?.name, group?.name].filter(Boolean).join(' · '),
      timestamp: match.playedAt || match.receivedAt || null,
      winner: result.winner || null,
      playerCount: result.playerCount ?? null
    };
  }

  return { enabledSections, describeMatch };
}));
