'use strict';

/**
 * Límites de peticiones y guardas de seguridad.
 *
 * La web está en Internet. Estas pruebas fijan que cada puerta tiene su cerrojo
 * —login, tokens de administración, escrituras, subidas, avatar— y, sobre todo,
 * que los cerrojos no se abren con trucos baratos: rotar la IP en una cabecera,
 * o compartir conexión para agotar el margen de otro.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { RATE_LIMIT_DEFAULTS } = require('../src/security/rate-limits');

describe('límites y seguridad', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-limites-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const ADMIN = 'admin-test-'.padEnd(64, 'x');
  const silencio = { info() {}, error() {} };

  /** Una app con límites diminutos, para no tener que mandar seiscientas peticiones. */
  function montar({ limites = {}, trustProxy = false } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'torneo-limites', name: 'Torneo', game: 'Valorant', description: 'x',
      status: 'Inscripciones abiertas', registrationsOpen: true, minParticipants: 4,
      modules: { registration: true, participants: true, information: false }
    });
    const app = createApp({
      database, logger: silencio, adminToken: ADMIN, trustProxy,
      rateLimits: { ...RATE_LIMIT_DEFAULTS, ...limites }
    });
    return { database, app, evento };
  }

  const pequeno = (limit) => ({ windowMs: 60 * 1000, limit });

  /** Manda N peticiones y devuelve las respuestas. */
  async function rafaga(n, hacer) {
    const respuestas = [];
    for (let i = 0; i < n; i += 1) respuestas.push(await hacer(i));
    return respuestas;
  }

  describe('forma de la respuesta', () => {
    it('un 429 explica qué pasa y cuándo volver', async () => {
      const { app } = montar({ limites: { global: pequeno(2) } });
      await rafaga(2, () => request(app).get('/api/events'));
      const bloqueada = await request(app).get('/api/events');
      assert.equal(bloqueada.status, 429);
      assert.equal(bloqueada.body.error.code, 'RATE_LIMITED');
      assert.ok(bloqueada.body.error.message);
      assert.ok(bloqueada.headers['retry-after'], 'dice cuántos segundos esperar');
    });

    it('las respuestas normales anuncian el límite con las cabeceras estándar', async () => {
      const { app } = montar();
      const respuesta = await request(app).get('/api/events').expect(200);
      assert.ok(respuesta.headers.ratelimit || respuesta.headers['ratelimit-policy'],
        'cabeceras RateLimit del borrador IETF');
      assert.equal(respuesta.headers['x-ratelimit-limit'], undefined, 'sin las heredadas');
    });
  });

  describe('global', () => {
    it('corta a quien inunda', async () => {
      const { app } = montar({ limites: { global: pequeno(5) } });
      const respuestas = await rafaga(7, () => request(app).get('/api/events'));
      assert.deepEqual(respuestas.map((r) => r.status), [200, 200, 200, 200, 200, 429, 429]);
    });

    it('la sonda de salud no cuenta: la usan el despliegue y la monitorización', async () => {
      const { app } = montar({ limites: { global: pequeno(1) } });
      const respuestas = await rafaga(5, () => request(app).get('/api/health'));
      assert.ok(respuestas.every((r) => r.status === 200));
    });
  });

  describe('la IP no se puede falsificar', () => {
    it('con TRUST_PROXY=1 sólo cuenta el salto que añade el proxy', async () => {
      /*
        Así llega una petición a través de Tailscale: el cliente puede mandar
        la X-Forwarded-For que quiera, y el proxy AÑADE al final la dirección
        real. Con un salto de confianza, Express usa ese último valor.
        Rotar el primero —el que controla el atacante— no cambia de cubo.
      */
      const { app } = montar({ trustProxy: 1, limites: { global: pequeno(3) } });
      const IP_REAL = '198.51.100.9';
      const respuestas = await rafaga(6, (i) => request(app).get('/api/events')
        .set('X-Forwarded-For', `203.0.113.${i + 1}, ${IP_REAL}`));
      assert.deepEqual(respuestas.map((r) => r.status), [200, 200, 200, 429, 429, 429],
        'rotar la IP falsa no da un límite nuevo');
    });

    it('dos clientes reales distintos tienen cada uno su margen', async () => {
      const { app } = montar({ trustProxy: 1, limites: { global: pequeno(2) } });
      await rafaga(2, () => request(app).get('/api/events').set('X-Forwarded-For', '198.51.100.1'));
      const otro = await request(app).get('/api/events').set('X-Forwarded-For', '198.51.100.2');
      assert.equal(otro.status, 200, 'que uno abuse no bloquea al resto');
    });
  });

  describe('login con Discord', () => {
    it('no se puede iniciar sesión en bucle', async () => {
      const { app } = montar({ limites: { auth: pequeno(3) } });
      const respuestas = await rafaga(5, () => request(app).get('/auth/discord'));
      // Sin Discord configurado responde 503; el límite cuenta igual.
      assert.equal(respuestas.at(-1).status, 429);
      assert.equal(respuestas.filter((r) => r.status === 429).length, 2);
    });
  });

  describe('tokens de administración', () => {
    const conToken = (app, token) => request(app).get('/api/admin/events')
      .set('Authorization', `Bearer ${token}`);

    it('tras varios fallos bloquea, aunque luego se acierte', async () => {
      const { app } = montar({ limites: { adminFailures: pequeno(3) } });
      const fallos = await rafaga(3, () => conToken(app, 'token-inventado'));
      assert.ok(fallos.every((r) => r.status === 401));

      const cuarto = await conToken(app, 'otro-intento');
      assert.equal(cuarto.status, 429);
      assert.equal(cuarto.body.error.code, 'ADMIN_LOCKED_OUT');

      // Aquí está la gracia: acertar después de probar no desbloquea.
      const acierto = await conToken(app, ADMIN);
      assert.equal(acierto.status, 429, 'probar tokens hasta dar con uno no funciona');
    });

    it('el administrador que trabaja no se bloquea a sí mismo', async () => {
      const { app } = montar({ limites: { adminFailures: pequeno(3) } });
      // Muchas peticiones buenas y errores de formulario (400): no cuentan.
      const buenas = await rafaga(10, () => conToken(app, ADMIN));
      assert.ok(buenas.every((r) => r.status === 200));
      const erroneas = await rafaga(5, () => request(app).post('/api/admin/events')
        .set('Authorization', `Bearer ${ADMIN}`).send({}));
      assert.ok(erroneas.every((r) => r.status !== 429), 'un formulario mal no es un ataque');
      await conToken(app, ADMIN).expect(200);
    });
  });

  describe('escrituras de jugadores', () => {
    function sesion(database, nombre) {
      const cuenta = database.valorant.upsertDiscordAccount({
        discordUserId: `u-${nombre}`, username: nombre, displayName: nombre
      });
      return `jarti_session=${database.valorant.createSession(cuenta.id)}`;
    }
    const marcar = (app, evento, cookie) => request(app)
      .put(`/api/events/${evento.slug}/availability`).set('Cookie', cookie).send({ days: [] });

    it('se cuentan por cuenta de Discord, no por conexión', async () => {
      /*
        Las dos cuentas salen de la misma IP —hermanos, una residencia, una LAN—.
        Contar por IP haría que una agotase el margen de la otra.
      */
      const { database, app, evento } = montar({ limites: { writes: pequeno(3) } });
      const ana = sesion(database, 'ana');
      const bea = sesion(database, 'bea');

      const deAna = await rafaga(4, () => marcar(app, evento, ana));
      assert.equal(deAna.at(-1).status, 429, 'Ana agota el suyo');

      const deBea = await marcar(app, evento, bea);
      assert.notEqual(deBea.status, 429, 'y Bea, desde la misma IP, sigue pudiendo');
    });

    it('sin sesión se cuenta por IP', async () => {
      const { app, evento } = montar({ limites: { writes: pequeno(2) } });
      const respuestas = await rafaga(3, () => request(app)
        .post(`/api/events/${evento.slug}/registrations`).send({}));
      assert.equal(respuestas.at(-1).status, 429);
    });

    it('leer no gasta el margen de escribir', async () => {
      const { app, evento } = montar({ limites: { writes: pequeno(1) } });
      await rafaga(5, () => request(app).get(`/api/events/${evento.slug}`));
      const escritura = await request(app).post(`/api/events/${evento.slug}/registrations`).send({});
      assert.notEqual(escritura.status, 429);
    });
  });

  describe('escrituras desde otra web', () => {
    it('un navegador que declara venir de otro sitio no puede escribir', async () => {
      const { app, evento } = montar();
      for (const origen of ['cross-site', 'same-site']) {
        const respuesta = await request(app).post(`/api/events/${evento.slug}/registrations`)
          .set('Sec-Fetch-Site', origen).send({});
        assert.equal(respuesta.status, 403, origen);
        assert.equal(respuesta.body.error.code, 'CROSS_SITE_REQUEST');
      }
    });

    it('la propia web sí, y un cliente sin navegador también', async () => {
      const { app, evento } = montar();
      const propia = await request(app).post(`/api/events/${evento.slug}/registrations`)
        .set('Sec-Fetch-Site', 'same-origin').send({});
      assert.notEqual(propia.status, 403);
      // El Reporter o curl no mandan la cabecera, y se autentican con token.
      const sinCabecera = await request(app).post(`/api/events/${evento.slug}/registrations`).send({});
      assert.notEqual(sinCabecera.status, 403);
    });

    it('leer desde otra web sigue permitido: son datos públicos', async () => {
      const { app, evento } = montar();
      await request(app).get(`/api/events/${evento.slug}`).set('Sec-Fetch-Site', 'cross-site').expect(200);
    });
  });

  describe('cabeceras', () => {
    it('declara que la web no usa cámara, micrófono ni ubicación', async () => {
      const { app } = montar();
      const respuesta = await request(app).get('/api/health').expect(200);
      assert.match(respuesta.headers['permissions-policy'], /camera=\(\)/);
      assert.match(respuesta.headers['permissions-policy'], /geolocation=\(\)/);
    });
  });

  describe('limpieza de lo caducado', () => {
    it('borra estados OAuth y sesiones vencidos, y respeta los vigentes', () => {
      const { database } = montar();
      const cuenta = database.valorant.upsertDiscordAccount({
        discordUserId: 'u-limpieza', username: 'limpieza', displayName: 'Limpieza'
      });
      database.valorant.createOAuthState({ ttlSeconds: -60 });   // caducado
      const vigente = database.valorant.createOAuthState({ ttlSeconds: 600 });
      database.valorant.createSession(cuenta.id, { ttlSeconds: -60 });   // caducada
      const sesionViva = database.valorant.createSession(cuenta.id, { ttlSeconds: 3600 });

      const borrado = database.valorant.purgeExpired();
      assert.deepEqual(borrado, { oauthStates: 1, sessions: 1 });

      assert.ok(database.valorant.consumeOAuthState(vigente.state, vigente.nonce),
        'el estado vigente sigue funcionando');
      assert.ok(database.valorant.getSession(sesionViva), 'y la sesión viva también');
    });

    it('un estado ya usado se conserva un día y luego se va', () => {
      const { database } = montar();
      const estado = database.valorant.createOAuthState({ ttlSeconds: 600 });
      database.valorant.consumeOAuthState(estado.state, estado.nonce);
      assert.deepEqual(database.valorant.purgeExpired(), { oauthStates: 0, sessions: 0 },
        'recién usado: se queda, para poder investigar');
      assert.equal(database.valorant.consumeOAuthState(estado.state, estado.nonce), null,
        'y repetirlo sigue rechazándose');
    });
  });

  describe('interruptor', () => {
    it('los límites están activos por defecto', async () => {
      const database = openDatabase(rutaTemporal());
      bases.push(database);
      const app = createApp({ database, logger: silencio, adminToken: ADMIN });
      const respuesta = await request(app).get('/api/events').expect(200);
      assert.ok(respuesta.headers.ratelimit || respuesta.headers['ratelimit-policy'],
        'seguro por defecto: nadie tiene que acordarse de activarlos');
    });
  });
});
