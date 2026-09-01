'use strict';

/**
 * El registro de juegos.
 *
 * La plataforma aloja torneos de juegos distintos. Lo que se prueba aquí es
 * que dar de alta uno nuevo no exija tocar código repartido, y sobre todo que
 * un juego del que no se sabe nada se comporte de forma razonable en vez de
 * romperse o de heredar cosas de Valorant.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { gameProfile, normalizeGame, isAmongUs, isValorant } = require('../src/games');
const { registrationFieldsForGame } = require('../src/events');

describe('registro de juegos', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-juegos-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  describe('lo que sabe de cada juego', () => {
    it('normaliza igual escriba como escriba', () => {
      for (const forma of ['Valorant', 'VALORANT', ' valorant ', 'vAlOrAnT']) {
        assert.equal(normalizeGame(forma), 'valorant');
        assert.equal(isValorant(forma), true);
      }
      for (const forma of ['Among Us', 'AMONG US', ' among us ']) {
        assert.equal(isAmongUs(forma), true);
      }
    });

    it('Valorant trae draft, equipos y capturas', () => {
      const perfil = gameProfile('Valorant');
      assert.equal(perfil.hasDraft, true);
      assert.equal(perfil.hasTeams, true);
      assert.equal(perfil.hasCaptures, true);
      assert.equal(perfil.playerIdField, 'riot_id');
    });

    it('Among Us recibe resultados solo y tiene su propia portada', () => {
      const perfil = gameProfile('Among Us');
      assert.equal(perfil.hasAutomaticReports, true);
      assert.equal(perfil.hasCaptures, false);
      assert.equal(perfil.playerIdField, 'friend_code');
      assert.equal(perfil.competitionPage, 'amongus-competition.html');
    });

    it('un juego desconocido no hereda nada de Valorant', () => {
      for (const juego of ['Fall Guys', 'CS:GO', 'Fortnite', 'Rocket League', '']) {
        const perfil = gameProfile(juego);
        assert.equal(perfil.hasDraft, false, `${juego} no debería traer draft`);
        assert.equal(perfil.hasCaptures, false, `${juego} no debería traer capturas`);
        assert.equal(perfil.playerIdField, null, `${juego} no tiene identificador propio todavía`);
        assert.equal(perfil.competitionPage, 'competition-page.html');
        assert.equal(isValorant(juego), false);
        assert.equal(isAmongUs(juego), false);
      }
    });

    it('nunca devuelve null: siempre hay con qué seguir', () => {
      for (const entrada of [undefined, null, '', '   ', 'Juego Que No Existe']) {
        assert.ok(gameProfile(entrada), `gameProfile(${JSON.stringify(entrada)}) no puede ser null`);
      }
    });
  });

  describe('un torneo de un juego nuevo funciona', () => {
    /** Crea un evento del juego dado con un inscrito que tiene sesión. */
    function eventoDe(juego) {
      const database = openDatabase(rutaTemporal());
      bases.push(database);
      const evento = database.createEvent({
        slug: 'torneo-nuevo',
        name: `Torneo ${juego}`,
        game: juego,
        description: 'Un torneo de otro juego.',
        status: 'Inscripciones abiertas',
        registrationsOpen: true,
        modules: { participants: true, information: true }
      });
      const inscrito = database.createParticipant(evento.id, {
        discord_username: 'jugador#discord', game_name: 'Jugador'
      });
      database.updateParticipant(inscrito.id, { status: 'confirmed' });
      const cuenta = database.valorant.upsertDiscordAccount({
        discordUserId: '777', username: 'jugador', displayName: 'Jugador'
      });
      database.valorant.linkParticipantToDiscord(inscrito.id, cuenta.id);
      const cookie = `jarti_session=${database.valorant.createSession(cuenta.id)}`;
      const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
      return { database, app, evento, cookie };
    }

    for (const juego of ['Fall Guys', 'CS:GO', 'Fortnite']) {
      it(`sirve las páginas públicas de un torneo de ${juego}`, async () => {
        const { app, evento } = eventoDe(juego);
        for (const ruta of [`/eventos/${evento.slug}`, `/eventos/${evento.slug}/informacion`,
          `/eventos/${evento.slug}/competicion`]) {
          await request(app).get(ruta).expect(200);
        }
        const detalle = await request(app).get(`/api/events/${evento.slug}`).expect(200);
        assert.equal(detalle.body.event.game, juego);
        // Ni rangos de Valorant ni formato oficial de otro torneo.
        assert.deepEqual(detalle.body.event.valorantPeakRanks, []);
        assert.equal(detalle.body.event.officialFormat, null);
      });
    }

    it('no ofrece la inscripción de Valorant a otro juego', async () => {
      const { app, evento } = eventoDe('Fall Guys');
      const respuesta = await request(app)
        .post(`/api/events/${evento.slug}/valorant/registrations`)
        .send({ riotId: 'Alguien#0000', acceptedTerms: true, acceptedRules: true });
      assert.equal(respuesta.status, 404);
      assert.equal(respuesta.body.error.code, 'MODULE_DISABLED');
    });

    it('el perfil enseña la inscripción sin inventarle equipo ni clasificación', async () => {
      const { app, cookie } = eventoDe('CS:GO');
      const cuerpo = (await request(app).get('/api/me/profile').set('Cookie', cookie).expect(200)).body;
      const registro = cuerpo.registrations[0];

      assert.equal(registro.game, 'CS:GO');
      assert.equal(registro.team, null);
      assert.equal(registro.riotId, null);
      // Sin competición montada no hay nada que contar, y no se finge que sí.
      assert.equal(registro.standing ?? null, null);
      assert.equal(registro.nextMatch ?? null, null);
    });

    it('la inscripción sólo pide lo que ese juego necesita', () => {
      const claves = (juego) => registrationFieldsForGame(juego).map((campo) => campo.key);
      assert.ok(claves('Among Us').includes('friend_code'));
      assert.ok(!claves('Fall Guys').includes('friend_code'));
      assert.ok(!claves('Fall Guys').includes('riot_id'));
      assert.ok(!claves('Fortnite').includes('peak_rank'));
    });
  });
});
