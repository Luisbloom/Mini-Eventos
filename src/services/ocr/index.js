'use strict';

/**
 * Lector de texto en imágenes.
 *
 * El resto del sistema —el clasificador, los parsers, la previsualización— no
 * sabe qué motor hay debajo. Habla con esta forma y ya está:
 *
 *   recognize(imagen) -> { text, words: [{ text, confidence, bbox }], confidence }
 *
 * Así se puede cambiar de motor sin tocar nada de lo que interpreta el
 * resultado, y las pruebas pueden usar un motor falso y determinista en vez de
 * depender de que un OCR real acierte.
 */

const { createTesseractProvider } = require('./tesseract-provider');
const { createFakeProvider } = require('./fake-provider');

/** Una palabra reconocida, con dónde estaba y cuánto se fía el motor. */
function word(text, confidence, bbox) {
  return {
    text: String(text),
    confidence: Number(confidence) || 0,
    bbox: {
      x0: Number(bbox?.x0) || 0,
      y0: Number(bbox?.y0) || 0,
      x1: Number(bbox?.x1) || 0,
      y1: Number(bbox?.y1) || 0
    }
  };
}

/**
 * Agrupa las palabras en líneas por su posición vertical.
 *
 * Un scoreboard es una tabla, y el texto plano de un OCR pierde justo lo que la
 * hace legible: qué número va con qué jugador. Con las cajas se recupera.
 */
function linesFromWords(words, { tolerance = 0.6 } = {}) {
  const ordenadas = [...words].sort((uno, otro) => uno.bbox.y0 - otro.bbox.y0);
  const lineas = [];

  for (const palabra of ordenadas) {
    const alto = Math.max(1, palabra.bbox.y1 - palabra.bbox.y0);
    const centro = (palabra.bbox.y0 + palabra.bbox.y1) / 2;

    // Dos palabras están en la misma fila si sus centros caen dentro de una
    // fracción de la altura del texto. Comparar sólo y0 falla con acentos y
    // mayúsculas.
    const linea = lineas.find((candidata) =>
      Math.abs(candidata.center - centro) <= alto * tolerance);

    if (linea) {
      linea.words.push(palabra);
      linea.center = linea.words.reduce(
        (total, w) => total + (w.bbox.y0 + w.bbox.y1) / 2, 0) / linea.words.length;
    } else {
      lineas.push({ center: centro, words: [palabra] });
    }
  }

  return lineas.map((linea) => {
    const palabras = [...linea.words].sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
    return {
      text: palabras.map((p) => p.text).join(' '),
      words: palabras,
      bbox: {
        x0: Math.min(...palabras.map((p) => p.bbox.x0)),
        y0: Math.min(...palabras.map((p) => p.bbox.y0)),
        x1: Math.max(...palabras.map((p) => p.bbox.x1)),
        y1: Math.max(...palabras.map((p) => p.bbox.y1))
      },
      confidence: palabras.reduce((total, p) => total + p.confidence, 0) / palabras.length
    };
  });
}

/** Normaliza lo que devuelva un motor a la forma que espera el resto. */
function normalizeResult(raw) {
  const words = (raw?.words || []).map((w) => word(w.text, w.confidence, w.bbox))
    .filter((w) => w.text.trim() !== '');
  const lines = linesFromWords(words);
  return {
    text: raw?.text ?? lines.map((linea) => linea.text).join('\n'),
    words,
    lines,
    confidence: words.length
      ? words.reduce((total, w) => total + w.confidence, 0) / words.length
      : 0
  };
}

module.exports = {
  createTesseractProvider,
  createFakeProvider,
  linesFromWords,
  normalizeResult,
  word
};
