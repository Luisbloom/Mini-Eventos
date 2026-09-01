'use strict';

/**
 * El avatar propio, donde se te nombra a ti.
 *
 * Lo que estas pruebas protegen no es que se vea la foto: es que se vea **sin
 * publicar el id de Discord**. La URL del CDN lleva el id dentro, así que la
 * tentación de servirla tal cual reaparece cada vez que alguien toca esto.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');

describe('avatar de la cuenta', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-avatar-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const DISCORD_ID = '987654321098765432';

  function montar({ avatar = 'a1b2c3d4e5f6' } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: DISCORD_ID, username: 'luis', displayName: 'Luis', avatar
    });
    return { database, app, cookie: `jarti_session=${database.valorant.createSession(cuenta.id)}` };
  }

  it('la cuenta trae su avatar por la ruta propia', async () => {
    const { app, cookie } = montar();
    const { body } = await request(app).get('/api/me').set('Cookie', cookie).expect(200);
    assert.equal(body.authenticated, true);
    assert.equal(body.avatar, '/api/me/avatar');
  });

  it('nunca sale el id de Discord ni la URL del CDN', async () => {
    const { app, cookie } = montar();
    for (const ruta of ['/api/me', '/api/me/profile']) {
      const respuesta = await request(app).get(ruta).set('Cookie', cookie).expect(200);
      const texto = JSON.stringify(respuesta.body);
      // El id va dentro de la URL del CDN: publicar la URL es publicar el id.
      assert.ok(!texto.includes(DISCORD_ID), `${ruta} filtra el id`);
      assert.ok(!texto.includes('cdn.discordapp.com'), `${ruta} filtra el CDN`);
      assert.ok(!texto.includes('a1b2c3d4e5f6'), `${ruta} filtra el hash del avatar`);
    }
  });

  it('una cuenta sin avatar dice que no lo tiene, no una ruta que fallará', async () => {
    const { app, cookie } = montar({ avatar: null });
    const { body } = await request(app).get('/api/me').set('Cookie', cookie).expect(200);
    assert.equal(body.avatar, null);
  });

  it('sin sesión no hay avatar que dar', async () => {
    const { app } = montar();
    const anonimo = await request(app).get('/api/me').expect(200);
    assert.equal(anonimo.body.authenticated, false);
    assert.equal(anonimo.body.avatar, undefined);
    await request(app).get('/api/me/avatar').expect(401);
  });

  describe('en las páginas', () => {
    const leer = (nombre) => fs.readFileSync(path.join(__dirname, '..', 'public', nombre), 'utf8');

    it('todas las páginas con barra de perfil cargan el avatar', () => {
      const publicas = fs.readdirSync(path.join(__dirname, '..', 'public'))
        .filter((nombre) => nombre.endsWith('.html'));
      const conBarra = publicas.filter((nombre) => leer(nombre).includes('profile-entry'));
      assert.ok(conBarra.length >= 5, 'la barra está en varias páginas');
      for (const pagina of conBarra) {
        assert.ok(leer(pagina).includes('src="/avatar.js"'),
          `${pagina} enseña la barra pero no carga el avatar`);
      }
    });

    it('la imagen se pide a la ruta propia, nunca a Discord', () => {
      const js = leer('avatar.js');
      assert.ok(!js.includes('cdn.discordapp.com'),
        'pedirla al CDN pondría el id de la cuenta en el HTML');
      assert.ok(js.includes('/api/me'), 'la cuenta se pregunta al servidor');
    });

    it('si la imagen no carga, se quedan las iniciales', () => {
      const js = leer('avatar.js');
      // Un hueco vacío en la barra se lee como que algo se ha roto.
      assert.ok(js.includes("addEventListener('error'"), 'el fallo está contemplado');
      assert.ok(js.includes("addEventListener('load'"), 'y sólo se pinta lo que carga');
      assert.match(js, /hueco\.textContent = iniciales\(nombre\)/);
    });

    it('el bloque de Discord del evento usa el mismo camino', () => {
      const js = leer('event.js');
      assert.ok(js.includes("window.Avatar?.pintar(byId('discord-initials')"),
        'la inscripción enseña el avatar igual que la barra');
    });
  });
});
