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
    it('son seis series, siete si hay final de desempate', () => {
      assert.equal(PLAYOFF_LOAD.series, 6);
      assert.equal(PLAYOFF_LOAD.seriesWithReset, 7);
      // Y coincide con el cuadro declarado, que es de donde sale.
      assert.equal(PLAYOFF_LOAD.seriesWithReset, PLAN.length);
      assert.ok(PLAN.some((serie) => serie.slot === SLOTS.GRAND_FINAL_RESET));
    });

    it('cada equipo juega entre 2 y 5 eliminatorias', () => {
      // 2 el que cae primero; 5 el finalista que fuerza el desempate.
      assert.deepEqual(PLAYOFF_LOAD.perTeam, { min: 2, max: 5 });
    });

    it('el campeón juega 3 si no pierde y 5 si pierde una vez', () => {
      // Las cinco son las mismas pierda donde pierda: caer antes te ahorra la
      // final alta pero te añade la ronda baja.
      assert.deepEqual(PLAYOFF_LOAD.champion, { undefeated: 3, throughLowerBracket: 5 });
    });
  });

  describe('el resumen por tamaño', () => {
    it('con 20 jugadores el campeón juega 6 u 8 partidos', () => {
      const veinte = matchSummary(20);
      assert.equal(veinte.league.perTeam, 3);
      assert.equal(veinte.champion.undefeated.matches, 6);
      assert.equal(veinte.champion.throughLowerBracket.matches, 8);
      // Un BO1 es un mapa; un BO3, dos o tres. De ahí la horquilla.
      assert.deepEqual(veinte.champion.undefeated.maps, { min: 9, max: 12 });
      assert.deepEqual(veinte.champion.throughLowerBracket.maps, { min: 13, max: 18 });
    });

    it('sólo crece la liga: los playoffs son siempre de cuatro equipos', () => {
      for (const jugadores of [20, 30, 40]) {
        const resumen = matchSummary(jugadores);
        assert.equal(resumen.playoffs.series, 6, `${jugadores} jugadores`);
        assert.equal(
          resumen.champion.undefeated.matches - resumen.league.perTeam,
          PLAYOFF_LOAD.champion.undefeated);
      }
      assert.equal(matchSummary(40).league.perTeam, 7);
    });

    it('una gran final a BO5 sube la cuenta de mapas, no la de partidos', () => {
      const tres = matchSummary(20);
      const cinco = matchSummary(20, { grandFinalBestOf: 5 });
      assert.equal(cinco.champion.undefeated.matches, tres.champion.undefeated.matches);
      assert.ok(cinco.champion.undefeated.maps.max > tres.champion.undefeated.maps.max);
      // La final de desempate se juega al mismo formato que la gran final, así
      // que al campeón que viene de abajo le suben las dos.
      assert.equal(cinco.champion.throughLowerBracket.maps.max
        - tres.champion.throughLowerBracket.maps.max, 4);
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
