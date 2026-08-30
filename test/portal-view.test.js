'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PortalView = require('../public/portal-view');

describe('cartelera pública', () => {
  it('permite abrir un evento Próximamente aunque sus inscripciones estén cerradas', () => {
    assert.equal(PortalView.eventHref({
      slug: 'torneo-valorant',
      status: 'Próximamente',
      registrationsOpen: false
    }), '/eventos/torneo-valorant');
  });
  it('separa el evento vigente del historial sin ocultar sus enlaces', () => {
    const valorant = { slug: 'torneo-valorant', status: 'Próximamente' };
    const amongUs = { slug: 'among-us-agosto-2026', status: 'Finalizado' };
    const sections = PortalView.splitEvents([amongUs, valorant]);

    assert.deepEqual(sections.current, [valorant]);
    assert.deepEqual(sections.history, [amongUs]);
    assert.equal(PortalView.eventHref(sections.history[0]), '/eventos/among-us-agosto-2026');
  });
});
