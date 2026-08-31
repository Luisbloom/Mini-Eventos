(function exposeEventView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EventView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function competitionAccessCopy(event = {}) {
    return String(event.game || '').trim().toLowerCase() === 'valorant'
      ? 'Draft, fase regular y playoffs'
      : 'Grupos, clasificación y gran final';
  }

  return { competitionAccessCopy };
}));
