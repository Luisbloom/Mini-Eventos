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
});
