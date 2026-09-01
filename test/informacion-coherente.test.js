'use strict';

/**
 * La información del torneo no puede contradecir al propio torneo.
 *
 * Se abrieron las inscripciones y la página de información siguió diciendo
 * «todavía no están abiertas», debajo de un titular que decía lo contrario.
 * Era un texto fijo describiendo algo que cambia solo.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const {
  OFFICIAL_VALORANT_SLUG, OFFICIAL_VALORANT_FORMAT, registrationSentence
} = require('../src/valorant-event-format');

describe('información coherente con el estado del evento', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-info-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  function montar({ registrationsOpen = true, inscritos = 0 } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: OFFICIAL_VALORANT_SLUG, name: 'Torneo Valorant', game: 'Valorant',
      description: 'x', status: registrationsOpen ? 'Inscripciones abiertas' : 'Próximamente',
      registrationsOpen, minParticipants: 20, maxParticipants: 40,
      modules: { information: true, registration: true, participants: true }
    });
    for (let i = 0; i < inscritos; i += 1) {
      database.createParticipant(evento.id, { discord_username: `p${i}`, game_name: `J${i}` });
    }
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    return { database, app, evento };
  }

  const informacion = (app) => request(app)
    .get(`/api/events/${OFFICIAL_VALORANT_SLUG}/tournament-information`).expect(200);

  it('con las inscripciones abiertas, no dice que estén cerradas', async () => {
    const { app } = montar({ registrationsOpen: true, inscritos: 1 });
    const { body } = await informacion(app);

    assert.equal(body.event.registration.available, true);
    const frase = body.event.officialFormat.public.registration;
    assert.ok(/abiertas/.test(frase), frase);
    assert.ok(!/todavía no|no están abiertas|cerrad/i.test(frase),
      `la información desmiente al evento: ${frase}`);
    assert.ok(frase.includes('1 persona apuntada'), frase);
  });

  it('cerradas, tampoco dice que estén abiertas', async () => {
    const { app } = montar({ registrationsOpen: false });
    const { body } = await informacion(app);
    assert.equal(body.event.registration.available, false);
    assert.ok(!/están abiertas/.test(body.event.officialFormat.public.registration));
  });

  it('la misma frase la ve la página del evento', async () => {
    const { app } = montar({ registrationsOpen: true, inscritos: 3 });
    const evento = await request(app).get(`/api/events/${OFFICIAL_VALORANT_SLUG}`).expect(200);
    const info = await informacion(app);
    assert.equal(evento.body.event.officialFormat.public.registration,
      info.body.event.officialFormat.public.registration);
  });

  it('el aforo lleno se dice como lleno, no como una cuenta atrás', () => {
    const frase = registrationSentence({
      slug: OFFICIAL_VALORANT_SLUG, registration: { available: true }, participantCount: 40
    });
    assert.ok(/completo/i.test(frase), frase);
    assert.ok(!/Faltan/.test(frase), frase);
  });

  describe('lo que se declara pendiente', () => {
    const pendientes = OFFICIAL_VALORANT_FORMAT.pending.join(' | ');

    it('no lista como pendiente lo que la página ya explica', () => {
      // El desempate está decidido y escrito: victorias, directo, rondas, ACS.
      assert.ok(!/desempate/i.test(pendientes), pendientes);
      assert.ok(OFFICIAL_VALORANT_FORMAT.public.tiebreakers.includes('ACS'));
    });

    it('sigue diciendo lo que de verdad no se sabe', () => {
      for (const cosa of ['Fecha', 'Horarios', 'Servidor']) {
        assert.ok(pendientes.includes(cosa), `${cosa} debería seguir pendiente`);
      }
    });

    it('el map pool aparece con la decisión que ya está tomada', () => {
      const linea = OFFICIAL_VALORANT_FORMAT.pending.find((c) => /Map pool/i.test(c));
      assert.ok(linea, pendientes);
      assert.match(linea, /mismo día/);
    });
  });
});
