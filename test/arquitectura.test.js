'use strict';

/**
 * Freno a que el código vuelva a donde estaba.
 *
 * app.js llegó a unas 2.000 líneas y 125 rutas, con rutas enteras escritas en
 * una sola línea de casi mil caracteres. Funciona y está probado, pero es donde
 * un cambio pequeño rompe algo sin querer. No se reescribe: se impide que siga
 * engordando y que vuelva a aparecer código comprimido.
 *
 * Si esta prueba falla por añadir una ruta, la ruta no va en app.js: va en un
 * módulo propio (src/routes/<área>.js que exporta una función que recibe `app`
 * y lo que necesite) y app.js sólo la registra. Subir el límite no es la salida.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

// Medido el 2026-09-15, justo después de desplegar las líneas comprimidas (que
// por sí solo sumó unas 120 líneas sin añadir nada). Sólo puede bajar.
const APP_MAX_LINEAS = 2213;
const APP_MAX_RUTAS = 125;
// Más larga que esto, una línea de código ya no se lee de un vistazo.
const MAX_CODIGO_POR_LINEA = 200;
// `)return`, `;const x`, `catch(error){`: sentencias pegadas unas a otras.
const PEGADO = /\)return\b|;(?:const|let|if|return|response|try)\b|catch\s*\(\w+\)\{/;

function ficherosJs(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return ficherosJs(ruta);
    return entrada.name.endsWith('.js') ? [ruta] : [];
  });
}

/**
 * La línea sin sus textos. Las frases publicadas del formato o una consulta SQL
 * pueden ser largas y seguir siendo legibles; lo que no se lee es la lógica.
 */
function soloCodigo(linea) {
  return linea
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('arquitectura', () => {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  it(`app.js no pasa de ${APP_MAX_RUTAS} rutas`, () => {
    const rutas = app.match(/^\s*app\.(get|post|put|patch|delete)\(/gm) || [];
    assert.ok(rutas.length <= APP_MAX_RUTAS,
      `app.js tiene ${rutas.length} rutas (máximo ${APP_MAX_RUTAS}). Las nuevas van en src/routes/<área>.js.`);
  });

  it(`app.js no pasa de ${APP_MAX_LINEAS} líneas`, () => {
    // Como `wc -l`: el salto de línea final no abre una línea más.
    const lineas = app.split('\n').length - (app.endsWith('\n') ? 1 : 0);
    assert.ok(lineas <= APP_MAX_LINEAS,
      `app.js tiene ${lineas} líneas (máximo ${APP_MAX_LINEAS}). Saca la parte nueva a su propio módulo.`);
  });

  it('no hay código comprimido en una sola línea', () => {
    const comprimidas = [];
    for (const fichero of ficherosJs(SRC)) {
      fs.readFileSync(fichero, 'utf8').split('\n').forEach((linea, indice) => {
        const codigo = soloCodigo(linea).trim();
        if (codigo.startsWith('//') || codigo.startsWith('*')) return;
        // Además de la longitud, las huellas de escribir de una tirada: varias
        // sentencias pegadas sin espacios. Hubo rutas enteras así de menos de
        // 200 caracteres que la longitud sola no veía.
        if (codigo.length > MAX_CODIGO_POR_LINEA || PEGADO.test(codigo)) {
          comprimidas.push(`${path.relative(SRC, fichero)}:${indice + 1} (${codigo.length})`);
        }
      });
    }
    assert.deepEqual(comprimidas, [],
      `Líneas de código de más de ${MAX_CODIGO_POR_LINEA} caracteres: sepáralas en varias.`);
  });
});
