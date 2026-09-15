'use strict';

/**
 * Lo que la web dice de sí misma, en cada momento del torneo.
 *
 * Es el fallo que más se ha repetido en este proyecto: inscripciones «cerradas»
 * estando abiertas, un draft que «no existía», una competición «en marcha» sin
 * empezar, «4 equipos de 5» con 40 jugadores. Cada vez se arregló la frase y se
 * añadió una prueba que buscaba la frase en el código.
 *
 * Buscar la frase no basta: comprueba que el texto existe, no que se diga en el
 * momento correcto. Aquí se PINTA la portada de la competición en cada estado
 * del ciclo de vida —antes, abierta, cerrada, liga, playoffs, campeón— y se
 * compara lo que leería una persona con lo que es verdad en ese estado.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { OFFICIAL_VALORANT_FORMAT, officialSizeForPlayers } = require('../src/valorant-event-format');

const publico = (nombre) => path.join(__dirname, '..', 'public', nombre);
const leer = (nombre) => fs.readFileSync(publico(nombre), 'utf8');

/* Un DOM mínimo: sólo lo que usan los renderers, y el texto que se vería. */
function elemento(tag) {
  let texto = '';
  const el = {
    tagName: tag.toUpperCase(), className: '', children: [], dataset: {}, style: {}, attributes: {},
    get textContent() { return texto + el.children.map((hijo) => hijo.textContent).join(' '); },
    set textContent(valor) { texto = String(valor); el.children = []; },
    append(...hijos) { el.children.push(...hijos.map((h) => (typeof h === 'string' ? textoSuelto(h) : h))); },
    replaceChildren(...hijos) { el.children = []; texto = ''; el.append(...hijos); },
    setAttribute(nombre, valor) { el.attributes[nombre] = String(valor); },
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    get options() { return el.children.filter((h) => h.tagName === 'OPTION'); }
  };
  return el;
}
const textoSuelto = (valor) => ({ textContent: valor, children: [] });

describe('la web dice la verdad sobre su propio estado', () => {
  let Renderers;
  const anteriores = {};

  before(() => {
    for (const clave of ['document', 'window', 'CompetitionView', 'CompetitionRenderers']) anteriores[clave] = globalThis[clave];
    globalThis.document = { createElement: elemento, createTextNode: textoSuelto };
    globalThis.window = { location: { search: '', pathname: '/' } };
    globalThis.CompetitionView = require(publico('competition-view.js'));
    vm.runInThisContext(leer('competition-renderers.js'), { filename: 'competition-renderers.js' });
    Renderers = globalThis.CompetitionRenderers;
  });
  after(() => {
    for (const [clave, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete globalThis[clave]; else globalThis[clave] = valor;
    }
  });

  const equipos = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1}`, members: [] }));

  /** Lo que leería alguien que abre la portada de la competición. */
  function portada({ registration = { available: true }, state = {}, draft = null, preview = false } = {}) {
    const event = { slug: 'torneo-valorant', name: 'Cup', status: 'Inscripciones abiertas', registration, officialFormat: OFFICIAL_VALORANT_FORMAT };
    const context = {
      route: { name: 'hub', slug: event.slug }, slug: event.slug, event, draft,
      state: { teams: [], seriesTotal: 0, seriesPlayed: 0, format: OFFICIAL_VALORANT_FORMAT, ...(preview ? { preview: true } : {}), ...state }
    };
    return { texto: Renderers.render(context).textContent, cabecera: Renderers.describe(context) };
  }

  it('inscripciones abiertas y sin draft: ni «en marcha» ni «cerradas»', () => {
    const { texto } = portada({ registration: { available: true } });
    assert.match(texto, /Todavía no ha empezado/);
    assert.match(texto, /inscripciones siguen abiertas/i);
    assert.doesNotMatch(texto, /en marcha|campeón/i);
  });

  it('inscripciones cerradas y sin draft: no promete que sigan abiertas', () => {
    const { texto } = portada({ registration: { available: false, code: 'CLOSED' } });
    assert.match(texto, /Todavía no ha empezado/);
    assert.match(texto, /inscripciones están cerradas/i);
    assert.doesNotMatch(texto, /siguen abiertas/i);
  });

  it('con la liga en juego: en marcha, y ni cerrada ni con campeón', () => {
    const { texto } = portada({ state: { teams: equipos(4), seriesTotal: 6, seriesPlayed: 2, generated: true } });
    assert.match(texto, /La competición está en marcha/);
    assert.doesNotMatch(texto, /Todavía no ha empezado|campeón|inscripciones/i);
  });

  it('con los playoffs empezados no sigue hablando sólo del seeding', () => {
    const { texto } = portada({ state: {
      teams: equipos(4), seriesTotal: 6, seriesPlayed: 6, generated: true, complete: true,
      playoffs: { generated: true, status: 'PENDING', champion: null, placements: [], series: [{ status: 'COMPLETED' }] }
    } });
    assert.match(texto, /Playoffs en juego/);
    assert.doesNotMatch(texto, /Seeding confirmado|campeón/);
  });

  it('con la gran final jugada, la portada nombra al campeón', () => {
    const { texto } = portada({ state: {
      teams: equipos(4), seriesTotal: 6, seriesPlayed: 6, generated: true, complete: true,
      playoffs: { generated: true, status: 'COMPLETED', champion: 3, runnerUp: 1,
        placements: [{ teamId: 3, name: 'Los Jartos', position: 1 }], series: [{ status: 'COMPLETED' }] }
    } });
    assert.match(texto, /🏆 Los Jartos, campeón/);
    assert.match(texto, /El torneo ha terminado/);
    assert.doesNotMatch(texto, /Seeding confirmado|en marcha|Playoffs en juego/);
  });

  it('un campeón sin final jugada no existe', () => {
    const { texto } = portada({ state: {
      teams: equipos(4), seriesTotal: 6, seriesPlayed: 6, generated: true, complete: true,
      playoffs: { generated: true, status: 'PENDING', champion: 3, placements: [{ teamId: 3, name: 'Los Jartos' }], series: [] }
    } });
    assert.doesNotMatch(texto, /campeón/);
  });

  it('con 6 u 8 equipos no dice que todos clasifican', () => {
    for (const jugadores of [30, 40]) {
      const tamano = officialSizeForPlayers(jugadores);
      const { cabecera } = portada({ state: { teams: equipos(tamano.teams), seriesTotal: tamano.regularSeason.series, generated: true } });
      const playoffs = cabecera.kpis.find(([etiqueta]) => etiqueta === 'PLAYOFFS')[1];
      assert.equal(playoffs, 'TOP 4', `${jugadores} jugadores`);
    }
    const { cabecera } = portada({ state: { teams: equipos(4), seriesTotal: 6, generated: true } });
    assert.equal(cabecera.kpis.find(([etiqueta]) => etiqueta === 'PLAYOFFS')[1], 'TODOS CLASIFICAN');
  });

  describe('textos fijos que dependían del número de jugadores', () => {
    it('la previa del draft no lleva «4 equipos de 5» ni «20 participantes» escritos a mano', () => {
      const html = leer('draft.html');
      assert.doesNotMatch(html, /4 equipos de 5|los 20 participantes|Cuatro rondas/);
      const js = leer('draft.js');
      for (const id of ['draft-preview-rounds-title', 'draft-preview-final-title', 'draft-preview-final-copy']) {
        assert.ok(html.includes(`id="${id}"`) && js.includes(`byId('${id}')`), `${id} se rellena desde el formato`);
      }
    });

    it('inscribirse con las inscripciones cerradas no promete que se abrirán', () => {
      const js = leer('event.js');
      const linea = js.split('\n').find((l) => l.trim().startsWith('REGISTRATION_CLOSED:'));
      assert.ok(linea, 'hay mensaje para REGISTRATION_CLOSED');
      assert.doesNotMatch(linea, /todavía no/i);
      assert.match(js, /REGISTRATION_NOT_OPEN_YET:/);
    });
  });
});
