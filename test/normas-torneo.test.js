'use strict';

/**
 * Aceptar las normas del torneo.
 *
 * Los términos dicen qué se hace con tus datos; las normas dicen cómo se juega,
 * y llevan una sanción dentro: usar un arma vetada descalifica al equipo entero
 * en ese mismo momento. Nadie puede quedarse fuera por una regla que no se le
 * puso delante, así que se acepta aparte y se comprueba aparte.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { requireRulesConsent, eventHasRules, ConsentError } = require('../src/legal-consent');

describe('normas del torneo', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-normas-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  function montar({ information = true } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'torneo-normas', name: 'Torneo', game: 'Fall Guys', description: 'x',
      status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { registration: true, participants: true, information }
    });
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: '77', username: 'luis', displayName: 'Luis'
    });
    return { database, app, evento, cookie: `jarti_session=${database.valorant.createSession(cuenta.id)}` };
  }

  const inscribir = (app, evento, cookie, cuerpo) => request(app)
    .post(`/api/events/${evento.slug}/registrations`).set('Cookie', cookie)
    .send({ values: { game_name: 'Luis' }, ...cuerpo });

  describe('cuándo se exigen', () => {
    it('donde hay normas publicadas', () => {
      assert.equal(eventHasRules({ modules: { information: true } }), true);
    });

    it('y no donde no las hay: no se pide un «acepto» a ciegas', () => {
      assert.equal(eventHasRules({ modules: { information: false } }), false);
      assert.equal(eventHasRules({ modules: {} }), false);
      assert.equal(eventHasRules(null), false);
    });
  });

  it('sin marcarlas no se puede uno inscribir', async () => {
    const { app, evento, cookie } = montar();
    const respuesta = await inscribir(app, evento, cookie, { acceptedTerms: true });
    assert.equal(respuesta.status, 400);
    assert.equal(respuesta.body.error.code, 'RULES_CONSENT_REQUIRED');
  });

  it('son una casilla aparte de los términos, no la misma', async () => {
    const { app, evento, cookie } = montar();
    // Aceptar las normas no acepta los términos...
    const sinTerminos = await inscribir(app, evento, cookie, { acceptedRules: true });
    assert.equal(sinTerminos.body.error.code, 'CONSENT_REQUIRED');
    // ...ni al revés. Un único «acepto» dejaría en duda cuál de las dos leyó.
    const sinNormas = await inscribir(app, evento, cookie, { acceptedTerms: true });
    assert.equal(sinNormas.body.error.code, 'RULES_CONSENT_REQUIRED');
  });

  it('tampoco cuela desde fuera del navegador', async () => {
    const { app, evento, cookie } = montar();
    for (const trampa of [false, 'false', 0, null, 'sí']) {
      const respuesta = await inscribir(app, evento, cookie,
        { acceptedTerms: true, acceptedRules: trampa });
      assert.equal(respuesta.status, 400, `${JSON.stringify(trampa)} no puede valer`);
      assert.equal(respuesta.body.error.code, 'RULES_CONSENT_REQUIRED');
    }
  });

  it('con las dos marcadas, se inscribe', async () => {
    const { app, evento, cookie } = montar();
    await inscribir(app, evento, cookie, { acceptedTerms: true, acceptedRules: true }).expect(201);
  });

  it('un evento sin normas publicadas no las pide', async () => {
    const { app, evento, cookie } = montar({ information: false });
    await inscribir(app, evento, cookie, { acceptedTerms: true }).expect(201);
  });

  it('la comprobación suelta explica qué falta', () => {
    assert.throws(() => requireRulesConsent(undefined), (error) => (
      error instanceof ConsentError && error.code === 'RULES_CONSENT_REQUIRED'));
    assert.equal(requireRulesConsent(true), true);
  });

  describe('en la página', () => {
    const leer = (nombre) => fs.readFileSync(path.join(__dirname, '..', 'public', nombre), 'utf8');

    it('las dos inscripciones tienen su casilla de normas', () => {
      const html = leer('event.html');
      const js = leer('event.js');
      assert.ok(html.includes('id="registration-rules"'), 'la genérica');
      assert.ok(js.includes("id=\"riot-rules\""), 'y la de Valorant');
      assert.ok(js.includes('acceptedRules'), 'y se envía');
    });

    it('ninguna viene marcada de antemano', () => {
      for (const fuente of [leer('event.html'), leer('event.js')]) {
        const trozo = fuente.slice(fuente.indexOf('-rules') - 200, fuente.indexOf('-rules') + 200);
        assert.ok(!trozo.includes('checked'), 'una casilla premarcada no es aceptar nada');
      }
    });

    it('enlazan a las normas de ESE torneo, no a un texto genérico', () => {
      const js = leer('event.js');
      // Aceptar algo que no se puede abrir no es aceptar nada.
      assert.ok(js.includes('/informacion'), 'hay enlace a la información del evento');
      assert.ok(js.includes("byId('registration-rules-link').href"),
        'el enlace se arma con el slug del evento');
    });

    it('la casilla dice que hay sanción, no sólo «acepto»', () => {
      const html = leer('event.html');
      const js = leer('event.js');
      for (const fuente of [html, js]) {
        assert.match(fuente, /descalifica al equipo entero/);
      }
    });
  });
});
