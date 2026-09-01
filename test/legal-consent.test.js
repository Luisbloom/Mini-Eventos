'use strict';

/**
 * El consentimiento al inscribirse.
 *
 * La política de privacidad dice que la base legal es el consentimiento. Estas
 * pruebas comprueban que de verdad se pide, que no se puede saltar desde fuera
 * del navegador, y que queda guardado con fecha y versión: sin eso, la política
 * afirma algo que nadie podría demostrar.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { LEGAL_VERSION, hasAccepted, requireConsent, ConsentError } = require('../src/legal-consent');

describe('consentimiento legal', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-consent-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  describe('qué cuenta como aceptar', () => {
    it('acepta lo que mandan un formulario y un JSON', () => {
      for (const valor of [true, 'true', 'on', 1, '1']) {
        assert.equal(hasAccepted(valor), true, `${JSON.stringify(valor)} debería valer`);
      }
    });

    it('todo lo demás es que no ha aceptado', () => {
      for (const valor of [undefined, null, false, 'false', 'off', 0, '', 'sí', {}, []]) {
        assert.equal(hasAccepted(valor), false, `${JSON.stringify(valor)} no puede valer`);
      }
    });

    it('guarda cuándo y qué versión se aceptó', () => {
      const consent = requireConsent(true, { now: new Date('2026-08-31T18:00:00Z') });
      assert.equal(consent.acceptedAt, '2026-08-31T18:00:00.000Z');
      assert.equal(consent.version, LEGAL_VERSION);
    });

    it('sin aceptar, no hay consentimiento que guardar', () => {
      assert.throws(() => requireConsent(false), (error) => (
        error instanceof ConsentError && error.code === 'CONSENT_REQUIRED'));
    });
  });

  describe('en la inscripción', () => {
    function montar() {
      const database = openDatabase(rutaTemporal());
      bases.push(database);
      const evento = database.createEvent({
        slug: 'torneo-consent',
        name: 'Torneo de prueba',
        game: 'Fall Guys',
        description: 'x',
        status: 'Inscripciones abiertas',
        registrationsOpen: true,
        modules: { registration: true, participants: true }
      });
      const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
      // Para inscribirse hace falta Discord, así que toda prueba lleva sesión.
      const cuenta = database.valorant.upsertDiscordAccount({
        discordUserId: '4242', username: 'luis', displayName: 'Luis'
      });
      const cookie = `jarti_session=${database.valorant.createSession(cuenta.id)}`;
      return { database, app, evento, cookie };
    }

    const inscribir = (app, slug, cuerpo, cookie) => request(app)
      .post(`/api/events/${slug}/registrations`).set('Cookie', cookie).send(cuerpo);

    it('no deja inscribirse sin aceptar', async () => {
      const { app, evento, cookie } = montar();
      const respuesta = await inscribir(app, evento.slug, {
        values: { game_name: 'Nadie' }
      }, cookie);
      assert.equal(respuesta.status, 400);
      assert.equal(respuesta.body.error.code, 'CONSENT_REQUIRED');
    });

    it('tampoco aceptando a medias desde fuera del navegador', async () => {
      const { app, evento, cookie } = montar();
      // La casilla vive en la página, pero quien manda la petición a mano se la
      // salta: por eso se comprueba aquí y no sólo allí.
      for (const trampa of [false, 'false', 0, null, 'quizá']) {
        const respuesta = await inscribir(app, evento.slug, {
          values: { game_name: 'X' },
          acceptedTerms: trampa
        }, cookie);
        assert.equal(respuesta.status, 400, `${JSON.stringify(trampa)} no puede colar`);
        assert.equal(respuesta.body.error.code, 'CONSENT_REQUIRED');
      }
    });

    it('aceptando, se inscribe y queda registrado con fecha y versión', async () => {
      const { app, database, evento, cookie } = montar();
      const antes = new Date().toISOString();

      const respuesta = await inscribir(app, evento.slug, {
        values: { game_name: 'Luis' },
        acceptedTerms: true
      }, cookie);
      assert.equal(respuesta.status, 201);

      const inscrito = database.listParticipants(evento.id)[0];
      assert.equal(inscrito.consentVersion, LEGAL_VERSION);
      assert.ok(inscrito.consentAt >= antes, 'la fecha tiene que ser la de ahora');
    });

    it('el consentimiento no se publica con los participantes', async () => {
      const { app, database, evento, cookie } = montar();
      await inscribir(app, evento.slug, {
        values: { game_name: 'Luis' }, acceptedTerms: true
      }, cookie).expect(201);
      database.listParticipants(evento.id)
        .forEach((p) => database.updateParticipant(p.id, { status: 'confirmed' }));

      const publico = await request(app).get(`/api/events/${evento.slug}/participants`).expect(200);
      const texto = JSON.stringify(publico.body);
      assert.ok(!texto.includes('consentAt'));
      assert.ok(!texto.includes('consentVersion'));
    });
  });

  describe('en la página', () => {
    it('el formulario tiene una casilla de verdad, y sin marcar', () => {
      const html = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'event.html'), 'utf8');
      assert.match(html, /id="registration-consent"[^>]*type="checkbox"|type="checkbox"[^>]*id="registration-consent"/);
      // Una casilla premarcada no es consentimiento.
      const casilla = html.slice(html.indexOf('registration-consent') - 120,
        html.indexOf('registration-consent') + 120);
      assert.ok(!casilla.includes('checked'), 'no puede venir marcada de antemano');
      assert.ok(casilla.includes('required'));
    });

    it('las dos inscripciones enlazan los textos que se aceptan', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.js'), 'utf8');

      // Aceptar algo sin poder leerlo no es consentimiento informado.
      for (const fuente of [html, js]) {
        assert.ok(fuente.includes('href="/terminos"'));
        assert.ok(fuente.includes('href="/privacidad"'));
      }
      assert.ok(js.includes('riot-consent'), 'la inscripción de Valorant también la pide');
      assert.ok(js.includes('acceptedTerms'), 'y la envía');
    });
  });
});
