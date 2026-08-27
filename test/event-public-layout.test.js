'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');

describe('portada pública mínima del evento', () => {
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
