'use strict';

/**
 * Lo que se ve entre abrir inscripciones y hacer el draft.
 *
 * Es el estado en el que está el torneo ahora mismo y el que menos se prueba:
 * hay evento, hay gente apuntándose, y todavía no hay ni equipos ni calendario.
 * Aquí la web decía dos cosas falsas —«este evento no utiliza draft por equipos»
 * y «la competición está en marcha»— y encima una de ellas sin estilos.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');

describe('antes del draft', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-antes-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  function montar({ draft = true } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'torneo-antes', name: 'Jartiland Valorant Cup', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      minParticipants: 20, maxParticipants: 40,
      modules: { registration: true, participants: true, competition: true, draft }
    });
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    return { database, app, evento };
  }

  describe('el servidor separa los dos motivos', () => {
    it('con el draft encendido y sin hacer: DRAFT_NOT_FOUND', async () => {
      const { app, evento } = montar({ draft: true });
      const respuesta = await request(app).get(`/api/events/${evento.slug}/draft`).expect(404);
      assert.equal(respuesta.body.error.code, 'DRAFT_NOT_FOUND');
    });

    it('sin módulo de draft: MODULE_DISABLED', async () => {
      const { app, evento } = montar({ draft: false });
      const respuesta = await request(app).get(`/api/events/${evento.slug}/draft`).expect(404);
      assert.equal(respuesta.body.error.code, 'MODULE_DISABLED');
    });
  });

  describe('y la página los cuenta distinto', () => {
    const leer = (nombre) => fs.readFileSync(path.join(__dirname, '..', 'public', nombre), 'utf8');

    it('un draft que aún no se ha hecho no es un evento sin draft', () => {
      const js = leer('draft.js');
      // Decir «este evento no utiliza draft» en el torneo que lo utiliza y lo
      // tiene anunciado era, sencillamente, mentira.
      const desde = js.indexOf("DRAFT_NOT_FOUND: [");
      // Sólo su entrada: la de al lado sí puede decir «no utiliza draft», que
      // es su caso, y cortar de más hacía pasar la prueba por el motivo malo.
      const entrada = js.slice(desde, js.indexOf('],', desde));
      assert.ok(entrada.startsWith("DRAFT_NOT_FOUND: ['Aún no hay draft'"),
        'el draft pendiente tiene su propio aviso');
      assert.ok(!entrada.includes('no utiliza draft'),
        'no puede negar el draft de un torneo que sí lo tiene');
    });

    it('sigue diciendo la verdad donde de verdad no hay draft', () => {
      const js = leer('draft.js');
      assert.ok(js.includes(
        "MODULE_DISABLED: ['Sin draft', 'Este evento no utiliza draft por equipos.']"),
      'donde el módulo está apagado, el mensaje de siempre');
    });

    it('el aviso se ve con estilos en todas las páginas que lo usan', () => {
      const compartido = leer('styles.css');
      // Vivía en event.css, que sólo carga la página del evento: en draft.html y
      // en la competición de Among Us salía pegado al borde y con el enlace en
      // azul del navegador. Un aviso mal pintado parece la web rota.
      assert.ok(compartido.includes('.event-fatal'), 'está en la hoja común');
      assert.ok(!leer('event.css').includes('.event-fatal'), 'y no duplicado en event.css');

      const paginas = fs.readdirSync(path.join(__dirname, '..', 'public'))
        .filter((nombre) => nombre.endsWith('.html') && leer(nombre).includes('event-fatal'));
      assert.ok(paginas.length >= 3, 'la usan varias páginas');
      for (const pagina of paginas) {
        assert.ok(leer(pagina).includes('href="/styles.css"'), `${pagina} carga la hoja común`);
      }
    });

    it('la competición no se declara en marcha sin equipos ni calendario', () => {
      const js = leer('competition-renderers.js');
      assert.ok(js.includes('Todavía no ha empezado'), 'hay un estado para antes de empezar');
      // Empezada es cuando hay equipos o series, no cuando existe el evento.
      assert.match(js, /const empezada = \(context\.state\.teams\?\.length \|\| 0\) > 0/);
    });
  });

  it('la competición pública responde vacía, no rota', async () => {
    const { app, evento } = montar();
    const { body } = await request(app)
      .get(`/api/events/${evento.slug}/competition-teams`).expect(200);
    assert.deepEqual(body.teams ?? [], []);
    // Sin equipos no hay nada que contar, y eso no es un error: es el estado.
    assert.equal(body.seriesTotal ?? 0, 0);
  });
});
