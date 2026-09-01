'use strict';

/**
 * Moverse entre las fases del torneo.
 *
 * Los enlaces del menú viven en el HTML con `href="/"` y el JavaScript les pone
 * la URL de verdad. Mientras eso pasaba dentro del dibujado —que sólo corre
 * cuando hay datos—, cualquier pantalla de «todavía no hay nada» dejaba el menú
 * entero apuntando a la portada: pulsabas «Fase regular» y te ibas al inicio.
 *
 * Navegar no depende de tener datos. El slug está en la URL.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (nombre) => fs.readFileSync(path.join(__dirname, '..', 'public', nombre), 'utf8');

describe('navegación entre fases', () => {
  describe('la página del draft', () => {
    const js = leer('draft.js');

    it('arma el menú antes de pedir el estado', () => {
      const arranque = js.slice(js.lastIndexOf('(async () => {'));
      const menu = arranque.indexOf('configurarNavegacion()');
      const estado = arranque.indexOf('pedirEstado()');
      assert.ok(menu !== -1, 'el menú se configura al arrancar');
      assert.ok(menu < estado, 'y antes de saber si hay draft');
    });

    it('el menú sólo necesita el slug, que sale de la URL', () => {
      const funcion = js.slice(js.indexOf('function configurarNavegacion()'),
        js.indexOf('function mostrarPrevia'));
      // Si necesitara el draft, volveríamos a tener que esperar a que cargue.
      assert.ok(!funcion.includes('draft.'), 'no depende del estado del draft');
      assert.ok(funcion.includes('encodeURIComponent(slug)'));
      for (const enlace of ['draft-nav-hub', 'draft-nav-regular', 'draft-nav-playoffs',
        'draft-nav-stats', 'back-to-event']) {
        assert.ok(funcion.includes(enlace), `${enlace} recibe su destino`);
      }
    });

    it('todos los enlaces del menú los rellena el JavaScript', () => {
      const html = leer('draft.html');
      const nav = html.slice(html.indexOf('<nav class="competition-nav"'),
        html.indexOf('</nav>', html.indexOf('<nav class="competition-nav"')));
      const ids = [...nav.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(ids.length >= 5, 'todos los enlaces tienen id');
      for (const id of ids) {
        assert.ok(js.includes(`byId('${id}')`), `${id} está en el HTML y nadie le pone destino`);
      }
    });
  });

  describe('la página de competición', () => {
    const js = leer('competition-pages.js');

    it('arma el menú y la vuelta al evento antes de cargar', () => {
      const arranque = js.slice(js.lastIndexOf('if (!route.slug)'));
      assert.ok(arranque.includes('buildNavigation()'), 'el menú se arma al arrancar');
      assert.ok(arranque.includes("byId('competition-event-link').href"),
        'y la vuelta al evento también');
      assert.ok(arranque.indexOf('buildNavigation()') < arranque.indexOf('refresh()'),
        'antes de pedir los datos');
    });
  });

  it('ninguna de las dos deja un enlace de fase en la portada', () => {
    // El `href="/"` del HTML es un marcador de posición, no un destino: si
    // alguien lo deja sin rellenar, el usuario acaba en el inicio sin entender
    // por qué. Estas dos páginas tienen que rellenarlos todos.
    for (const [pagina, script] of [['draft.html', 'draft.js'],
      ['competition-page.html', 'competition-pages.js']]) {
      const html = leer(pagina);
      const codigo = leer(script);
      const marcadores = [...html.matchAll(/<a id="([^"]+)"[^>]*href="\/"/g)].map((m) => m[1]);
      for (const id of marcadores) {
        assert.ok(codigo.includes(id), `${pagina}: ${id} se queda apuntando a la portada`);
      }
    }
  });
});
