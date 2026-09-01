'use strict';

/**
 * El orden de los inscritos y su llegada al perfil.
 *
 * Dos cosas que se piden desde fuera del código: saber exactamente quién se
 * apuntó primero, y que la inscripción aparezca sola en «Mi perfil» sin que
 * nadie la vincule a mano.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { registrationFieldsForGame } = require('../src/events');

describe('inscripciones', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-inscripciones-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  /** Una cuenta de Discord con sesión: sin ella no se puede inscribir nadie. */
  function sesionDe(database, sufijo, nombre) {
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: `u-${sufijo}`, username: nombre.toLowerCase(), displayName: nombre
    });
    return { cuenta, cookie: `jarti_session=${database.valorant.createSession(cuenta.id)}` };
  }

  function montar(game = 'Fall Guys') {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'torneo-orden', name: `Torneo ${game}`, game,
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { registration: true, participants: true }
    });
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    return { database, app, evento };
  }

  const inscribir = (app, database, slug, nombre) => request(app)
    .post(`/api/events/${slug}/registrations`)
    .set('Cookie', sesionDe(database, nombre, nombre).cookie)
    .send({ values: { game_name: nombre }, acceptedTerms: true });

  describe('orden de llegada', () => {
    it('los inscritos salen por orden de inscripción, no alfabético', async () => {
      const { app, database, evento } = montar();
      // A propósito al revés del alfabeto: si se ordenara por nombre saldría
      // Ana la primera, y la primera fue Zoe.
      for (const nombre of ['Zoe', 'Marco', 'Ana']) {
        await inscribir(app, database, evento.slug, nombre).expect(201);
      }
      database.listParticipants(evento.id)
        .forEach((p) => database.updateParticipant(p.id, { status: 'confirmed' }));

      const publico = await request(app).get(`/api/events/${evento.slug}/participants`).expect(200);
      assert.deepEqual(publico.body.participants.map((p) => p.displayName), ['Zoe', 'Marco', 'Ana']);
    });

    it('cada inscripción dice qué número de la cola es', async () => {
      const { app, database, evento } = montar();
      for (const nombre of ['Zoe', 'Marco', 'Ana']) {
        await inscribir(app, database, evento.slug, nombre).expect(201);
      }
      const inscritos = database.listParticipants(evento.id);
      assert.deepEqual(inscritos.map((p) => p.registrationOrder), [1, 2, 3]);
      assert.equal(inscritos[0].displayName, 'Zoe', 'la primera es la primera que llegó');
      assert.equal(inscritos.at(-1).displayName, 'Ana', 'y la última, la última');
    });

    it('la fecha exacta de inscripción es pública', async () => {
      const { app, database, evento } = montar();
      await inscribir(app, database, evento.slug, 'Zoe').expect(201);
      database.listParticipants(evento.id)
        .forEach((p) => database.updateParticipant(p.id, { status: 'confirmed' }));

      const publico = await request(app).get(`/api/events/${evento.slug}/participants`).expect(200);
      assert.match(publico.body.participants[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(publico.body.participants[0].registrationOrder, 1);
    });
  });

  describe('llega sola al perfil', () => {
    function conSesion(database, app) {
      const cuenta = database.valorant.upsertDiscordAccount({
        discordUserId: '55501', username: 'zoe', displayName: 'Zoe'
      });
      return { cuenta, cookie: `jarti_session=${database.valorant.createSession(cuenta.id)}` };
    }

    it('con la sesión abierta, la inscripción aparece en su perfil', async () => {
      const { app, database, evento } = montar();
      const { cookie } = conSesion(database, app);

      await request(app).post(`/api/events/${evento.slug}/registrations`)
        .set('Cookie', cookie)
        .send({ values: { discord_username: 'zoe', game_name: 'Zoe' }, acceptedTerms: true })
        .expect(201);

      const perfil = await request(app).get('/api/me/profile').set('Cookie', cookie).expect(200);
      assert.equal(perfil.body.registrations.length, 1);
      assert.equal(perfil.body.registrations[0].slug, evento.slug);
    });

    it('sin sesión no se puede uno inscribir', async () => {
      const { app, evento } = montar();
      // La identidad no se teclea: para apuntarse hace falta Discord.
      const respuesta = await request(app).post(`/api/events/${evento.slug}/registrations`)
        .send({ values: { game_name: 'Anónima' }, acceptedTerms: true });
      assert.equal(respuesta.status, 401);
      assert.equal(respuesta.body.error.code, 'AUTH_REQUIRED');
    });

    it('el usuario de Discord lo pone la sesión, no el formulario', async () => {
      const { app, database, evento } = montar();
      const { cookie } = conSesion(database, app);

      // Manda el usuario de otra persona: es texto libre y se ignora.
      await request(app).post(`/api/events/${evento.slug}/registrations`)
        .set('Cookie', cookie)
        .send({ values: { discord_username: 'otrapersona', game_name: 'Otra' }, acceptedTerms: true })
        .expect(201);

      const inscrito = database.listParticipants(evento.id)[0];
      assert.equal(inscrito.discordUsername, 'zoe', 'se guarda quien de verdad tiene la sesión');

      const otra = database.valorant.upsertDiscordAccount({
        discordUserId: '99999', username: 'otrapersona', displayName: 'Otra'
      });
      assert.equal(database.valorant.profileRegistrations(otra.id).length, 0,
        'no puede aparecer en el perfil de otra cuenta');
    });
  });

  describe('la puerta de Discord también está en la página', () => {
    it('sin sesión se ofrece entrar, no un formulario que va a fallar', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.js'), 'utf8');

      assert.ok(html.includes('id="registration-login"'), 'hay puerta');
      assert.ok(html.includes('id="registration-login-link"'), 'con su enlace');
      // El formulario sólo aparece con sesión, y se dice con qué cuenta.
      assert.ok(js.includes('yo.authenticated'));
      assert.ok(html.includes('id="registration-as"'));
    });

    it('el usuario de Discord ya no se teclea', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.js'), 'utf8');
      // Se filtra del formulario: lo pone el servidor con la sesión.
      assert.ok(js.includes("campo.key !== 'discord_username'"),
        'el campo no puede seguir pidiéndose');
    });
  });

  describe('las etiquetas hablan del juego que toca', () => {
    it('no dice Among Us en un torneo de otro juego', () => {
      for (const juego of ['Fall Guys', 'Fortnite', 'CS:GO']) {
        const etiquetas = registrationFieldsForGame(juego).map((campo) => campo.label).join(' | ');
        assert.ok(!etiquetas.includes('Among Us'), `${juego} no puede hablar de Among Us`);
        assert.ok(etiquetas.includes(juego), `${juego} debería nombrarse`);
      }
      // Y en Among Us, sí.
      assert.ok(registrationFieldsForGame('Among Us')
        .map((c) => c.label).join(' | ').includes('Among Us'));
    });
  });
});
