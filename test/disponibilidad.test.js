'use strict';

/**
 * Los días que puede cada inscrito.
 *
 * El torneo no necesita el día que le venga bien a todo el mundo: necesita el
 * primero en el que quepa una plantilla entera. Estas pruebas fijan esa regla
 * —que es la que hace que la decisión termine— y las dos que la sostienen:
 * marcar exige estar inscrito, y todo el mundo ve lo que han marcado los demás.
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
  WINDOW_DAYS, availabilityWindow, normalizeDay, normalizeDays,
  targetsFor, reachedTarget, addDays, AvailabilityError
} = require('../src/availability');
const { OFFICIAL_VALORANT_SLUG, OFFICIAL_SIZES } = require('../src/valorant-event-format');

describe('disponibilidad', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-dispo-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const hoy = () => new Date().toISOString().slice(0, 10);
  const dentro = (dias) => addDays(hoy(), dias);

  function montar({ slug = 'torneo-dispo', minParticipants = 4 } = {}) {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug, name: 'Torneo', game: 'Valorant', description: 'x',
      status: 'Inscripciones abiertas', registrationsOpen: true,
      minParticipants, maxParticipants: 40,
      modules: { registration: true, participants: true }
    });
    const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
    return { database, app, evento };
  }

  /** Alguien con sesión de Discord, inscrito o no según se pida. */
  function persona(database, evento, nombre, { inscrito = true } = {}) {
    const cuenta = database.valorant.upsertDiscordAccount({
      discordUserId: `u-${nombre}`, username: nombre.toLowerCase(), displayName: nombre
    });
    const cookie = `jarti_session=${database.valorant.createSession(cuenta.id)}`;
    if (!inscrito) return { cuenta, cookie, participante: null };
    const participante = database.createParticipant(evento.id, {
      discord_username: nombre.toLowerCase(), game_name: nombre
    });
    database.valorant.linkParticipantToDiscord(participante.id, cuenta.id);
    return { cuenta, cookie, participante };
  }

  describe('qué días se aceptan', () => {
    it('la ventana empieza hoy y dura ocho semanas', () => {
      const ventana = availabilityWindow(new Date('2026-09-01T10:00:00Z'));
      assert.equal(ventana.from, '2026-09-01');
      assert.equal(ventana.days, WINDOW_DAYS);
      assert.equal(ventana.to, '2026-10-26');
    });

    it('descarta lo que no es una fecha, incluido un 31 de febrero', () => {
      for (const malo of ['', 'mañana', '2026-9-5', '2026-02-31', '2026-13-01', null]) {
        assert.equal(normalizeDay(malo), null, `${JSON.stringify(malo)} no es una fecha`);
      }
      assert.equal(normalizeDay(' 2026-09-05 '), '2026-09-05');
    });

    it('quita repetidos y ordena', () => {
      const ahora = new Date('2026-09-01T00:00:00Z');
      assert.deepEqual(
        normalizeDays(['2026-09-06', '2026-09-05', '2026-09-06'], { now: ahora }),
        ['2026-09-05', '2026-09-06']);
    });

    it('un día fuera de la ventana es un error, no un descarte callado', () => {
      const ahora = new Date('2026-09-01T00:00:00Z');
      // Quien lo manda cree haberlo marcado: tragárselo en silencio le haría
      // creer que cuenta con un día que nadie ha guardado.
      for (const fuera of ['2026-08-31', '2027-01-01']) {
        assert.throws(() => normalizeDays([fuera], { now: ahora }),
          (error) => error instanceof AvailabilityError && error.code === 'DAY_OUT_OF_WINDOW');
      }
    });
  });

  describe('el umbral, no el consenso', () => {
    it('en el torneo oficial los umbrales son las plantillas exactas', () => {
      assert.deepEqual(targetsFor({ minParticipants: 20 }, OFFICIAL_SIZES), [20, 30, 40]);
    });

    it('en cualquier otro evento, el mínimo declarado', () => {
      assert.deepEqual(targetsFor({ minParticipants: 8 }), [8]);
      assert.deepEqual(targetsFor({ minParticipants: 0 }), [], 'sin mínimo no hay umbral');
    });

    it('un recuento alcanza el mayor umbral que cubre', () => {
      assert.equal(reachedTarget(19, [20, 30, 40]), null);
      assert.equal(reachedTarget(20, [20, 30, 40]), 20);
      assert.equal(reachedTarget(35, [20, 30, 40]), 30);
    });

    it('el día recomendado es el más cercano que llega, no el más marcado', async () => {
      const { database, app, evento } = montar({ minParticipants: 2 });
      const gente = ['Ana', 'Bea', 'Cid'].map((n) => persona(database, evento, n));

      // El día 10 lo pueden dos: ya es un torneo. El día 20 lo pueden tres.
      await marcar(app, gente[0].cookie, evento, [dentro(10), dentro(20)]);
      await marcar(app, gente[1].cookie, evento, [dentro(10), dentro(20)]);
      const ultimo = await marcar(app, gente[2].cookie, evento, [dentro(20)]);

      // Entre un día con 2 y otro con 3 no hay diferencia: los dos son el mismo
      // torneo de 2. Gana el más cercano y se deja de buscar.
      assert.equal(ultimo.body.recommended, dentro(10));
      assert.equal(ultimo.body.best.day, dentro(20));
      assert.equal(ultimo.body.best.count, 3);
    });

    it('sin nadie que llegue al umbral no se recomienda ningún día', async () => {
      const { database, app, evento } = montar({ minParticipants: 4 });
      const ana = persona(database, evento, 'Ana');
      const calendario = await marcar(app, ana.cookie, evento, [dentro(3)]);
      assert.equal(calendario.body.recommended, null);
      assert.deepEqual(calendario.body.best, { day: dentro(3), count: 1 });
    });
  });

  const marcar = (app, cookie, evento, days) => request(app)
    .put(`/api/events/${evento.slug}/availability`)
    .set('Cookie', cookie).send({ days }).expect(200);

  describe('quién puede marcar', () => {
    it('sin sesión, no', async () => {
      const { app, evento } = montar();
      const respuesta = await request(app)
        .put(`/api/events/${evento.slug}/availability`).send({ days: [dentro(2)] });
      assert.equal(respuesta.status, 401);
      assert.equal(respuesta.body.error.code, 'AUTH_REQUIRED');
    });

    it('con sesión pero sin estar inscrito, tampoco', async () => {
      const { database, app, evento } = montar();
      const curiosa = persona(database, evento, 'Curiosa', { inscrito: false });
      const respuesta = await request(app)
        .put(`/api/events/${evento.slug}/availability`)
        .set('Cookie', curiosa.cookie).send({ days: [dentro(2)] });
      // Marcar un día es prometer que se juega: sólo lo promete quien está.
      assert.equal(respuesta.status, 403);
      assert.equal(respuesta.body.error.code, 'NOT_REGISTERED');
    });

    it('la respuesta al marcar tiene la misma forma que la lectura', async () => {
      const { database, app, evento } = montar();
      const ana = persona(database, evento, 'Ana');
      const puesto = await marcar(app, ana.cookie, evento, [dentro(3)]);
      const leido = await request(app).get(`/api/events/${evento.slug}/availability`)
        .set('Cookie', ana.cookie).expect(200);
      // Un `days` suelto junto al del calendario se pisaba con él según el
      // orden de escritura: hay un único sitio donde viven los días de cada uno.
      assert.deepEqual(Object.keys(puesto.body).sort(), Object.keys(leido.body).sort());
      assert.deepEqual(puesto.body.me, leido.body.me);
    });

    it('quien está inscrito marca y lo guardado es lo que dice', async () => {
      const { database, app, evento } = montar();
      const ana = persona(database, evento, 'Ana');
      const respuesta = await marcar(app, ana.cookie, evento, [dentro(4), dentro(2)]);
      assert.deepEqual(respuesta.body.me, { registered: true, days: [dentro(2), dentro(4)] });

      const leido = await request(app).get(`/api/events/${evento.slug}/availability`)
        .set('Cookie', ana.cookie).expect(200);
      assert.deepEqual(leido.body.me, { registered: true, days: [dentro(2), dentro(4)] });
    });

    it('volver a marcar reemplaza: desmarcar es marcar menos', async () => {
      const { database, app, evento } = montar();
      const ana = persona(database, evento, 'Ana');
      await marcar(app, ana.cookie, evento, [dentro(2), dentro(3)]);
      const despues = await marcar(app, ana.cookie, evento, [dentro(3)]);
      assert.deepEqual(despues.body.me.days, [dentro(3)]);
      assert.equal(despues.body.days.find((f) => f.day === dentro(2)).count, 0,
        'el día que se desmarca deja de contar para todos');
    });
  });

  describe('todo el mundo ve los días de los demás', () => {
    it('el calendario público dice cuántos y quiénes', async () => {
      const { database, app, evento } = montar();
      for (const nombre of ['Ana', 'Bea']) {
        await marcar(app, persona(database, evento, nombre).cookie, evento, [dentro(5)]);
      }
      // Sin sesión ninguna: se ve igual, que es lo que hace que la gente ajuste.
      const publico = await request(app)
        .get(`/api/events/${evento.slug}/availability`).expect(200);
      const dia = publico.body.days.find((fecha) => fecha.day === dentro(5));
      assert.equal(dia.count, 2);
      assert.deepEqual(dia.people, ['Ana', 'Bea']);
      assert.deepEqual(publico.body.me, { registered: false, days: [] });
    });

    it('el calendario trae todos los días de la ventana, también los vacíos', async () => {
      const { app, evento } = montar();
      const { body } = await request(app).get(`/api/events/${evento.slug}/availability`).expect(200);
      assert.equal(body.days.length, WINDOW_DAYS);
      assert.equal(body.days[0].day, hoy());
      assert.ok(body.days.every((fecha) => Array.isArray(fecha.people)));
    });

    it('marca el día que ya llega al umbral', async () => {
      const { database, app, evento } = montar({ minParticipants: 2 });
      for (const nombre of ['Ana', 'Bea']) {
        await marcar(app, persona(database, evento, nombre).cookie, evento, [dentro(7)]);
      }
      const { body } = await request(app).get(`/api/events/${evento.slug}/availability`).expect(200);
      assert.equal(body.days.find((fecha) => fecha.day === dentro(7)).reached, 2);
      assert.equal(body.days.find((fecha) => fecha.day === dentro(8)).reached, null);
    });
  });

  describe('en el torneo oficial de Valorant', () => {
    it('los umbrales que publica son 20, 30 y 40', async () => {
      const { app } = montar({ slug: OFFICIAL_VALORANT_SLUG, minParticipants: 20 });
      const { body } = await request(app)
        .get(`/api/events/${OFFICIAL_VALORANT_SLUG}/availability`).expect(200);
      assert.deepEqual(body.targets, [20, 30, 40]);
    });
  });

  describe('en la página', () => {
    it('el calendario está enganchado y se carga con el evento', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.js'), 'utf8');
      assert.ok(html.includes('id="availability-calendar"'), 'hay calendario');
      assert.ok(html.includes('src="/availability.js"'), 'y su script');
      assert.ok(js.includes('window.Availability?.cargar'), 'la página lo arranca');
    });

    it('marcar no guarda: hay que confirmar', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'availability.js'), 'utf8');

      assert.ok(html.includes('id="availability-confirm"'), 'hay botón de confirmar');
      assert.ok(html.includes('id="availability-discard"'), 'y se pueden descartar los cambios');

      // El clic sólo toca el borrador; el PUT sale del botón, no de la casilla.
      const clic = js.slice(js.indexOf("availability-calendar')?.addEventListener"),
        js.indexOf("availability-confirm')?.addEventListener"));
      assert.ok(!clic.includes('fetch('), 'pulsar un día no llama al servidor');
      assert.ok(js.includes("byId('availability-confirm')?.addEventListener('click', confirmar)"),
        'confirmar es lo que guarda');
    });

    it('lo marcado sin confirmar se distingue de lo confirmado', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'availability.js'), 'utf8');
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.css'), 'utf8');
      // Si se vieran igual, el botón de confirmar no lo pulsaría nadie.
      assert.ok(js.includes("'is-draft'"), 'el borrador se marca en el DOM');
      assert.ok(css.includes('.availability-day.is-mine.is-draft'), 'y tiene su propio aspecto');
    });

    it('avisa antes de salir con días sin confirmar', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'availability.js'), 'utf8');
      assert.ok(js.includes("addEventListener('beforeunload'"),
        'marcar y cerrar la pestaña no puede perderse en silencio');
    });

    it('la sección de premios no se enseña vacía', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.js'), 'utf8');
      // «Lo que está en juego» con nada debajo promete premios que no existen.
      assert.ok(js.includes("byId('premios').hidden=!data.prizes.length"),
        'sin premios, la sección se oculta');
    });

    it('las fechas no se convierten a Date para pintarlas', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'availability.js'), 'utf8');
      // `new Date('2026-09-05')` es medianoche UTC: al oeste de Greenwich el
      // calendario enseñaría el día anterior al que se guarda.
      assert.ok(!/new Date\(\s*dia\s*\)/.test(js), 'una fecha corta no se parsea suelta');
      assert.ok(js.includes('Date.UTC('), 'el día de la semana se calcula en UTC');
    });
  });
});
