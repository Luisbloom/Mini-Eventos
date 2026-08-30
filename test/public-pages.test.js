'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');

describe('paginas publicas', () => {
  let directory, database, app, event;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-paginas-'));
    database = openDatabase(path.join(directory, 'tournament.db'));
    app = createApp({
      database, logger: { info() {}, error() {} }, adminToken: 'admin-test',
      publicBaseUrl: 'https://eventos.example'
    });
    event = database.getDefaultEvent();
    database.updateEvent(event.id, {
      ...event, name: 'Torneo de prueba', description: 'Un torneo con su descripción propia.'
    });
    event = database.getEventById(event.id);
  });
  afterEach(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  describe('legales', () => {
    for (const [ruta, marca] of [
      ['/privacidad', 'Política de privacidad'],
      ['/terminos', 'Términos y condiciones'],
      ['/contacto', 'Contacto']
    ]) {
      it(`sirve ${ruta}`, async () => {
        const respuesta = await request(app).get(ruta).expect(200);
        assert.match(respuesta.text, new RegExp(`<title>${marca}`));
        assert.match(respuesta.headers['content-type'], /html/);
      });
    }

    it('enlaza las legales desde todas las paginas publicas', async () => {
      const rutas = ['/', `/eventos/${event.slug}`, `/eventos/${event.slug}/informacion`,
        `/eventos/${event.slug}/competicion`, `/eventos/${event.slug}/competicion/draft`];
      for (const ruta of rutas) {
        const html = (await request(app).get(ruta).expect(200)).text;
        assert.ok(html.includes('href="/privacidad"'), `${ruta} sin enlace a privacidad`);
        assert.ok(html.includes('href="/terminos"'), `${ruta} sin enlace a terminos`);
      }
    });

    it('la politica dice que no hay analiticas ni rastreadores', async () => {
      const html = (await request(app).get('/privacidad')).text;
      assert.match(html, /no usamos analíticas/i);
      assert.match(html, /exentas de consentimiento/i);
    });
  });

  describe('404', () => {
    it('responde una pagina con identidad y salida, no texto plano', async () => {
      const respuesta = await request(app).get('/esto-no-existe').expect(404);
      assert.match(respuesta.headers['content-type'], /html/);
      assert.match(respuesta.text, /<title>Página no encontrada/);
      assert.ok(respuesta.text.includes('href="/"'), 'debe ofrecer una salida');
      assert.match(respuesta.text, /name="robots" content="noindex"/);
    });
  });

  describe('tarjetas sociales', () => {
    it('describe el evento concreto en la pagina del evento', async () => {
      const html = (await request(app).get(`/eventos/${event.slug}`).expect(200)).text;
      assert.match(html, /<title>Torneo de prueba · Mini Eventos Jartiland<\/title>/);
      assert.ok(html.includes('property="og:title" content="Torneo de prueba · Mini Eventos Jartiland"'));
      assert.ok(html.includes('content="Un torneo con su descripción propia."'));
      assert.ok(html.includes(`property="og:url" content="https://eventos.example/eventos/${event.slug}"`));
      assert.match(html, /property="og:image" content="https:\/\/eventos\.example\/images\//);
    });

    it('distingue el draft y la competicion del mismo evento', async () => {
      const draft = (await request(app).get(`/eventos/${event.slug}/competicion/draft`)).text;
      assert.match(draft, /<title>Draft · Torneo de prueba/);

      const competicion = (await request(app).get(`/eventos/${event.slug}/competicion`)).text;
      assert.match(competicion, /<title>Competición · Torneo de prueba/);
    });

    it('no deja etiquetas duplicadas', async () => {
      const html = (await request(app).get('/').expect(200)).text;
      assert.equal((html.match(/<title>/g) || []).length, 1);
      assert.equal((html.match(/property="og:title"/g) || []).length, 1);
      assert.equal((html.match(/name="description"/g) || []).length, 1);
    });

    it('un evento inexistente responde la pagina igual, con los datos del sitio', async () => {
      const respuesta = await request(app).get('/eventos/no-existe').expect(200);
      assert.match(respuesta.text, /<title>Mini Eventos Jartiland<\/title>/);
    });
  });

  describe('rastreadores', () => {
    it('robots.txt aparta administración y API, y apunta al mapa', async () => {
      const respuesta = await request(app).get('/robots.txt').expect(200);
      assert.match(respuesta.headers['content-type'], /text\/plain/);
      assert.match(respuesta.text, /Disallow: \/admin/);
      assert.match(respuesta.text, /Disallow: \/api\//);
      assert.match(respuesta.text, /Sitemap: https:\/\/eventos\.example\/sitemap\.xml/);
    });

    it('el mapa del sitio lista los eventos vivos y las legales', async () => {
      const respuesta = await request(app).get('/sitemap.xml').expect(200);
      assert.match(respuesta.headers['content-type'], /xml/);
      assert.ok(respuesta.text.includes(`<loc>https://eventos.example/eventos/${event.slug}</loc>`));
      assert.ok(respuesta.text.includes('<loc>https://eventos.example/privacidad</loc>'));
      assert.ok(respuesta.text.includes('<loc>https://eventos.example/terminos</loc>'));
    });

    it('el panel de administración no se indexa', async () => {
      const html = (await request(app).get('/admin').expect(200)).text;
      assert.match(html, /name="robots" content="noindex/);
    });
  });

  describe('rendimiento', () => {
    it('comprime el HTML cuando el navegador lo admite', async () => {
      const respuesta = await request(app).get('/').set('Accept-Encoding', 'gzip').expect(200);
      assert.equal(respuesta.headers['content-encoding'], 'gzip');
    });

    it('cachea las imagenes pero no el HTML', async () => {
      const imagen = await request(app).get('/images/logo-96.png').expect(200);
      assert.match(imagen.headers['cache-control'], /max-age=604800/);

      const hoja = await request(app).get('/styles.css').expect(200);
      assert.match(hoja.headers['cache-control'], /no-cache/);
    });
  });
});
