'use strict';

/**
 * OCR con Tesseract, en local y sin Internet.
 *
 * Tesseract.js se baja por defecto el motor y los datos del idioma de un CDN la
 * primera vez que se usa. El día del torneo eso es una dependencia de red en el
 * peor momento posible, así que todas las rutas apuntan a lo que hay instalado:
 * el motor en node_modules y el idioma en assets/tesseract.
 */

const path = require('node:path');
const fs = require('node:fs');

const RAIZ = path.join(__dirname, '..', '..', '..');
const LANG_PATH = path.join(RAIZ, 'assets', 'tesseract');
const CORE_PATH = path.dirname(require.resolve('tesseract.js-core/package.json'));

/** Números, letras y los signos que aparecen en un marcador. */
const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%+-.:/ ';

function trainedDataPath(lang = 'eng') {
  return path.join(LANG_PATH, `${lang}.traineddata.gz`);
}

/** Si se puede trabajar sin red. Se comprueba antes, no en mitad del torneo. */
function isOfflineReady(lang = 'eng') {
  return fs.existsSync(trainedDataPath(lang)) && fs.existsSync(CORE_PATH);
}

/**
 * @param {{lang?: string, whitelist?: string|null}} opciones
 */
function createTesseractProvider({ lang = 'eng', whitelist = CHAR_WHITELIST } = {}) {
  let worker = null;
  let arrancando = null;

  async function ensureWorker() {
    if (worker) return worker;
    // Un solo arranque aunque lleguen varias peticiones a la vez: crear dos
    // workers de Tesseract a la vez se come la memoria para nada.
    if (!arrancando) {
      arrancando = (async () => {
        if (!isOfflineReady(lang)) {
          throw new Error(
            `Falta el idioma ${lang} en ${LANG_PATH}. El OCR no debe depender de descargarlo.`);
        }
        const { createWorker } = require('tesseract.js');
        const creado = await createWorker(lang, 1, {
          langPath: LANG_PATH,
          corePath: CORE_PATH,
          gzip: true,
          cacheMethod: 'none',   // ya está en disco: no hace falta otra caché
          logger: () => {}
        });
        if (whitelist) {
          await creado.setParameters({ tessedit_char_whitelist: whitelist });
        }
        worker = creado;
        return creado;
      })();
    }
    return arrancando;
  }

  return {
    name: 'tesseract',
    isOfflineReady: () => isOfflineReady(lang),
    langPath: LANG_PATH,
    corePath: CORE_PATH,

    /** @param {Buffer} image */
    async recognize(image) {
      const activo = await ensureWorker();
      const { data } = await activo.recognize(image, {}, { blocks: true, text: true });

      // Según la versión, las palabras vienen sueltas o dentro de los bloques.
      const words = data.words?.length ? data.words : palabrasDeBloques(data.blocks);

      return {
        text: data.text ?? '',
        words: (words || []).map((palabra) => ({
          text: palabra.text,
          confidence: palabra.confidence,
          bbox: palabra.bbox
        }))
      };
    },

    async close() {
      const activo = worker;
      worker = null;
      arrancando = null;
      if (activo) await activo.terminate();
    }
  };
}

function palabrasDeBloques(blocks) {
  const sueltas = [];
  for (const bloque of blocks || []) {
    for (const parrafo of bloque.paragraphs || []) {
      for (const linea of parrafo.lines || []) {
        sueltas.push(...(linea.words || []));
      }
    }
  }
  return sueltas;
}

module.exports = { createTesseractProvider, isOfflineReady, trainedDataPath, LANG_PATH, CORE_PATH };
