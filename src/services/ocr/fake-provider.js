'use strict';

/**
 * OCR falso y determinista, para las pruebas.
 *
 * El parser, la fusión de capturas y la asociación de jugadores son lo que hay
 * que probar de verdad, y no se pueden probar bien si cada ejecución depende de
 * que un motor real acierte. Aquí se le dice exactamente qué ha «leído».
 *
 * También sirve para reproducir lo que salió mal: si un día una captura real se
 * lee raro, ese texto se guarda como fixture y queda cubierto para siempre.
 */

const ANCHO_CARACTER = 14;
const ALTO_LINEA = 34;

/**
 * Convierte un texto plano en palabras con caja, como si lo hubiera leído un
 * OCR. Las columnas salen de los espacios: separar con varios espacios coloca
 * las palabras en la misma rejilla en la que las buscará el parser.
 *
 * @param {string} texto
 * @param {{confidence?: number, lowConfidence?: Record<string, number>}} opciones
 */
function wordsFromText(texto, { confidence = 92, lowConfidence = {} } = {}) {
  const words = [];

  String(texto).split('\n').forEach((linea, fila) => {
    const y0 = fila * ALTO_LINEA;
    const patron = /\S+/g;
    let encontrado;
    while ((encontrado = patron.exec(linea)) !== null) {
      const x0 = encontrado.index * ANCHO_CARACTER;
      words.push({
        text: encontrado[0],
        confidence: lowConfidence[encontrado[0]] ?? confidence,
        bbox: {
          x0,
          y0,
          x1: x0 + encontrado[0].length * ANCHO_CARACTER,
          y1: y0 + ALTO_LINEA - 6
        }
      });
    }
  });

  return words;
}

/**
 * @param {string|Record<string,string>} guion  el texto a devolver, o un mapa de
 *   sha256 -> texto cuando una prueba usa varias imágenes distintas
 */
function createFakeProvider(guion, opciones = {}) {
  let actual = guion;
  const llamadas = [];

  return {
    name: 'fake',
    isOfflineReady: () => true,
    calls: llamadas,

    /**
     * Cambia lo que va a "leer" a partir de ahora. Hace falta cuando el texto
     * depende de datos que sólo existen después de montar el torneo, como los
     * Riot ID que el draft repartió entre los dos equipos del partido.
     */
    setScript(nuevoGuion) { actual = nuevoGuion; },

    async recognize(image, contexto = {}) {
      llamadas.push(contexto.key ?? null);
      const porImagen = typeof actual === 'string' ? null : { ...actual };
      const texto = porImagen
        ? (porImagen[contexto.key] ?? porImagen.default ?? '')
        : actual;
      return { text: texto, words: wordsFromText(texto, opciones) };
    },

    async close() { /* no hay nada que cerrar */ }
  };
}

module.exports = { createFakeProvider, wordsFromText };
