'use strict';

/**
 * Cuántos partidos juega cada equipo.
 *
 * Es la pregunta que hace todo el que se plantea apuntarse, y la que peor se
 * contesta a ojo: la doble eliminación no tiene un número fijo de partidos, y
 * «partido» y «mapa» no son lo mismo. Por eso los números se derivan del cuadro
 * de verdad en vez de escribirse: si cambia el cuadro, cambian solos.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { PLAYOFF_LOAD, matchSummary, OFFICIAL_VALORANT_SLUG } = require('../src/valorant-event-format');
const { PLAN, SLOTS } = require('../src/services/playoffs/bracket');

describe('cuántos partidos', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-carga-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  describe('el cuadro de eliminatorias', () => {
    it('son siete series, y todas se juegan', () => {
      // Seis del cuadro más el partido por el tercer puesto. Ninguna es
      // condicional desde que la gran final no tiene reposición.
      assert.equal(PLAYOFF_LOAD.series, 7);
      assert.equal(PLAYOFF_LOAD.series, PLAN.length);
      assert.ok(PLAN.some((serie) => serie.slot === SLOTS.THIRD_PLACE));
    });

    it('cada equipo juega 3 o 4 eliminatorias, nunca menos', () => {
      /*
        Con el tercer puesto en el cuadro ya no hay quien juegue sólo dos y se
        vaya a casa: el que cae primero disputa además el 3º-4º. Es la ventaja
        menos evidente de este formato, y la que más se agradece habiendo
        venido a jugar.
      */
      assert.deepEqual(PLAYOFF_LOAD.perTeam, { min: 3, max: 4 });
    });

    it('el campeón juega 3 si no pierde y 4 si pierde una vez', () => {
      // Las cuatro son las mismas pierda donde pierda: caer antes te ahorra la
      // final alta pero te añade la ronda baja. Y ya no hay una quinta, porque
      // la gran final se gana una sola vez.
      assert.deepEqual(PLAYOFF_LOAD.champion, { undefeated: 3, throughLowerBracket: 4 });
    });
  });

  describe('el resumen por tamaño', () => {
    it('con 20 jugadores el campeón juega 6 o 7 partidos', () => {
      const veinte = matchSummary(20);
      assert.equal(veinte.league.perTeam, 3);
      assert.equal(veinte.champion.undefeated.matches, 6);
      assert.equal(veinte.champion.throughLowerBracket.matches, 7);
      // Un BO1 es un mapa; un BO3, dos o tres; la final, de dos en adelante.
      assert.deepEqual(veinte.champion.undefeated.maps, { min: 9, max: 13 });
      assert.deepEqual(veinte.champion.throughLowerBracket.maps, { min: 11, max: 16 });
    });

    it('sólo crece la liga: los playoffs son siempre de cuatro equipos', () => {
      for (const jugadores of [20, 30, 40]) {
        const resumen = matchSummary(jugadores);
        assert.equal(resumen.playoffs.series, 7, `${jugadores} jugadores`);
        assert.equal(
          resumen.champion.undefeated.matches - resumen.league.perTeam,
          PLAYOFF_LOAD.champion.undefeated);
      }
      assert.equal(matchSummary(40).league.perTeam, 7);
    });

    it('la final aporta al menos dos mapas, y puede aportar más', () => {
      // Se gana por diferencia de dos: lo mínimo es un 2-0.
      const veinte = matchSummary(20);
      const sinFinal = veinte.league.perTeam + (PLAYOFF_LOAD.champion.undefeated - 1) * 2;
      assert.equal(veinte.champion.undefeated.maps.min - sinFinal, 2);
      assert.ok(veinte.champion.undefeated.maps.max > veinte.champion.undefeated.maps.min);
    });

    it('un tamaño que no existe no devuelve números inventados', () => {
      assert.equal(matchSummary(25), null);
      assert.equal(matchSummary(0), null);
    });
  });

  describe('en la página', () => {
    function montar(slug = OFFICIAL_VALORANT_SLUG) {
      const database = openDatabase(rutaTemporal());
      bases.push(database);
      const evento = database.createEvent({
        slug, name: 'Jartiland Valorant Cup', game: 'Valorant', description: 'x',
        status: 'Inscripciones abiertas', registrationsOpen: true, minParticipants: 20,
        modules: { information: true, registration: true, participants: true }
      });
      const app = createApp({ database, logger: { info() {}, error() {} }, adminToken: 'admin-test' });
      return { app, evento };
    }

    it('la información trae los tres tamaños calculados', async () => {
      const { app, evento } = montar();
      const { body } = await request(app)
        .get(`/api/events/${evento.slug}/tournament-information`).expect(200);
      assert.equal(body.matchSummaries.length, 3);
      assert.deepEqual(body.matchSummaries.map((r) => r.players), [20, 30, 40]);
      assert.equal(body.matchSummaries[0].champion.undefeated.matches, 6);
    });

    it('otro torneo no recibe números de este formato', async () => {
      const { app, evento } = montar('otro-torneo');
      const { body } = await request(app)
        .get(`/api/events/${evento.slug}/tournament-information`).expect(200);
      assert.equal(body.matchSummaries, null);
    });

    it('la explicación de las dos vidas está escrita en la página', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');
      // Lo que más se malentiende: que una derrota no elimina.
      assert.match(html, /dos vidas/i);
      assert.match(html, /perder <strong>dos veces<\/strong>/);
      for (const cuadro of ['CUADRO ALTO', 'CUADRO BAJO', 'GRAN FINAL']) {
        assert.ok(html.includes(cuadro), `falta ${cuadro}`);
      }
    });

    it('la tabla se pinta con lo que manda el servidor, sin números escritos', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'information.js'), 'utf8');
      assert.ok(html.includes('id="valorant-load-body"'), 'hay tabla');
      // El cuerpo va vacío en el HTML: si alguien escribiera «6 partidos» ahí,
      // seguiría diciéndolo el día que cambie el formato.
      assert.match(html, /<tbody id="valorant-load-body"><\/tbody>/);
      assert.ok(js.includes('renderValorantLoad(data.matchSummaries)'), 'y se rellena');
    });

    it('la tabla se desborda ella, no la página', () => {
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'information.css'), 'utf8');
      assert.match(css, /\.table-scroll \{ overflow-x: auto;/);
    });
  });
});
