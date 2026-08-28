'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EventView = require('../public/event-view');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');

describe('portada pública mínima del evento', () => {
  it('describe la competición según el formato real de cada juego', () => {
    assert.equal(EventView.competitionAccessCopy({ game: 'Among Us' }), 'Grupos, clasificación y gran final');
    assert.equal(EventView.competitionAccessCopy({ game: 'Valorant' }), 'Draft, fase regular y playoffs');
  });

  it('reserva la portada para resumen, premios, inscripción y accesos', () => {
    assert.match(html, /id="resumen"/);
    assert.match(html, /id="premios"/);
    assert.match(html, /id="inscripcion"/);
    assert.match(html, /id="event-primary-links"/);
    assert.doesNotMatch(html, /id="valorant-official"/);
    assert.doesNotMatch(html, /id="stage-board"/);
    assert.doesNotMatch(html, /id="participant-list"/);
    assert.doesNotMatch(html, /id="match-list"/);
  });
});
