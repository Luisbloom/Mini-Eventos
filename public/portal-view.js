(function exposePortalView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function eventHref(event = {}) {
    const slug = String(event.slug || '').trim();
    return slug ? `/eventos/${encodeURIComponent(slug)}` : null;
  }

  function isFinished(event = {}) {
    return String(event.status || '').trim().toLocaleLowerCase('es') === 'finalizado';
  }

  function splitEvents(events = []) {
    const visible = Array.isArray(events) ? events : [];
    return {
      current: visible.filter((event) => !isFinished(event)),
      history: visible.filter(isFinished)
    };
  }

  return { eventHref, isFinished, splitEvents };
}));
