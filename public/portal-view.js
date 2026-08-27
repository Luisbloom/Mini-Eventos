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

  return { eventHref };
}));
