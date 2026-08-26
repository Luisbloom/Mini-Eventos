'use strict';

/**
 * Estructura de una tabla a partir de dónde está cada palabra.
 *
 * Un scoreboard es una tabla, y el texto plano de un OCR pierde justo lo que la
 * hace legible: qué número va con qué jugador. Con las cajas se recupera.
 *
 * Todo se mide en proporción al ancho de la imagen, no en píxeles: la misma
 * captura a 1920 y reescalada a 1280 tiene que leerse igual.
 */

const {
  normalizeHeader, fieldForHeader, isKnownHeader, isSpacerHeader, MAX_HEADER_WORDS,
  PERCENT_FIELDS, DECIMAL_FIELDS
} = require('./columns');

const centroX = (palabra) => (palabra.bbox.x0 + palabra.bbox.x1) / 2;
const centroY = (palabra) => (palabra.bbox.y0 + palabra.bbox.y1) / 2;
const alto = (palabra) => Math.max(1, palabra.bbox.y1 - palabra.bbox.y0);

/** El ancho de la imagen, deducido de lo más a la derecha que se ha leído. */
function anchoDe(lines) {
  return Math.max(1, ...lines.flatMap((linea) => linea.words.map((p) => p.bbox.x1)));
}

/** Un número, o null. Nunca cero por defecto: ausente y cero son cosas distintas. */
function numero(bruto, { decimales = false } = {}) {
  if (bruto === null || bruto === undefined) return null;
  const limpio = String(bruto)
    .replace(/[%+]/g, '')
    .replace(/[−–—]/g, '-')          // el OCR usa guiones largos
    .replace(',', '.')
    .trim();
  if (limpio === '' || /^[-.]*$/.test(limpio)) return null;
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor)) return null;
  return decimales ? valor : Math.round(valor);
}

const esNumero = (texto) => numero(texto) !== null;

/**
 * Encuentra la fila de cabecera y dónde cae cada columna.
 *
 * Las cabeceras de varias palabras («PUNT. MED. COMBATE») llegan del OCR como
 * palabras sueltas, así que se prueban grupos de hasta cuatro seguidas y gana el
 * más largo que encaje: si no, «COMBATE» sola no diría nada y «PUNT» tampoco.
 */
function findHeader(lines) {
  let mejor = null;

  for (const [indice, linea] of lines.entries()) {
    const { columns, boundaries } = columnasDeLinea(linea);
    if (columns.length < 3) continue;
    if (!mejor || columns.length > mejor.columns.length) {
      mejor = { index: indice, columns, boundaries, line: linea };
    }
  }
  return mejor;
}

/**
 * Dónde empieza la primera columna, sea de datos o no.
 *
 * Todo lo que quede a su izquierda es el nombre del jugador.
 */
function nameLimit(cabecera) {
  const inicios = [...cabecera.columns, ...(cabecera.boundaries || [])]
    .map((columna) => columna.x0);
  return inicios.length ? Math.min(...inicios) : Infinity;
}

function columnasDeLinea(linea) {
  const palabras = [...linea.words].sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
  const columnas = [];
  const fronteras = [];
  let i = 0;

  while (i < palabras.length) {
    let avance = 0;
    // De más largo a más corto: «PRIMERAS SANGRES» antes que «PRIMERAS».
    for (let largo = Math.min(MAX_HEADER_WORDS, palabras.length - i); largo >= 1; largo--) {
      const grupo = palabras.slice(i, i + largo);
      const texto = grupo.map((p) => p.text).join(' ');
      // Una sola palabra puede ser una cabecera que el OCR fusionó.
      const pegada = largo === 1;
      if (!isKnownHeader(texto, { glued: pegada })) continue;

      const sitio = {
        field: fieldForHeader(texto, { glued: pegada }),
        x0: grupo[0].bbox.x0,
        x1: grupo[grupo.length - 1].bbox.x1,
        center: (grupo[0].bbox.x0 + grupo[grupo.length - 1].bbox.x1) / 2,
        words: largo
      };
      // Las que no traen número no son columnas de datos. Sólo marcan el final
      // del nombre las que ocupan una columna propia, no la que etiqueta la
      // columna del nombre.
      if (sitio.field) columnas.push(sitio);
      else if (isSpacerHeader(texto)) fronteras.push(sitio);
      avance = largo;
      break;
    }
    i += avance || 1;
  }

  // Una misma columna no puede salir dos veces; si pasa, es que se ha leído mal.
  const vistas = new Set();
  return {
    columns: columnas.filter((columna) => {
      if (vistas.has(columna.field)) return false;
      vistas.add(columna.field);
      return true;
    }),
    boundaries: fronteras
  };
}

/**
 * Dónde empieza de verdad la columna del nombre.
 *
 * A la izquierda del nombre hay retrato, insignia de nivel y rango, y el OCR
 * saca de ahí basura corta y variable («Ph», «GS r», «x.»). Filtrarla por su
 * texto sería adivinar; filtrarla por su posición no, porque en una tabla
 * **todos los nombres empiezan en la misma x**.
 *
 * Se toma, de cada fila, dónde empieza su palabra más larga, y se usa la
 * mediana: así una fila con el nombre mal leído no arrastra a las demás.
 */
function nameColumnStart(filas, limite) {
  const inicios = [];

  for (const fila of filas) {
    const dentro = fila.words.filter((palabra) => centroX(palabra) < limite);
    if (dentro.length === 0) continue;
    const masLarga = dentro.reduce((mejor, palabra) =>
      palabra.text.length > mejor.text.length ? palabra : mejor, dentro[0]);
    // Una palabra de una o dos letras no identifica una columna.
    if (masLarga.text.length >= 4) inicios.push(masLarga.bbox.x0);
  }

  if (inicios.length < 3) return null;      // sin filas suficientes, no se adivina
  inicios.sort((uno, otro) => uno - otro);
  return inicios[Math.floor(inicios.length / 2)];
}

/**
 * Reparte los números de una fila entre las columnas, por cercanía horizontal.
 *
 * La distancia admitida es proporcional al ancho de la imagen, no un número de
 * píxeles: con un umbral fijo, la misma captura a otra resolución pierde la
 * última columna y parece que falla el parser.
 */
function readRow(linea, cabecera, ancho) {
  const stats = {};
  const margen = ancho * 0.045;

  const candidatos = linea.words
    .map((palabra) => ({
      texto: palabra.text,
      center: centroX(palabra),
      usado: false
    }));

  for (const columna of cabecera.columns) {
    if (columna.field === 'kda') {
      const kda = leerKda(candidatos, columna, ancho);
      if (kda) Object.assign(stats, kda);
      continue;
    }

    const decimales = DECIMAL_FIELDS.has(columna.field);
    let mejor = null;
    let distancia = Infinity;

    for (const dato of candidatos) {
      if (dato.usado) continue;
      if (numero(dato.texto, { decimales }) === null) continue;
      const separacion = Math.abs(dato.center - columna.center);
      if (separacion < distancia) { distancia = separacion; mejor = dato; }
    }

    if (mejor && distancia <= margen) {
      mejor.usado = true;
      const valor = numero(mejor.texto, { decimales });
      if (PERCENT_FIELDS.has(columna.field) && (valor < 0 || valor > 100)) continue;
      stats[columna.field] = valor;
    }
  }

  return stats;
}

/**
 * La celda agrupada del cliente: «28 / 9 / 7».
 *
 * ⚠️ El OCR la parte de formas muy distintas según cómo caigan las barras:
 * entera («28/9/7»), en tres números sueltos, o con la barra pegada a un dígito
 * («28/», «/9», «28 / 9»). Por eso no se buscan «números»: se junta todo el
 * texto de esa columna y se leen los grupos de dígitos que haya.
 */
function leerKda(candidatos, columna, ancho) {
  const margen = ancho * 0.06;
  const juntos = candidatos
    .filter((dato) => !dato.usado && Math.abs(dato.center - columna.center) <= margen)
    .sort((uno, otro) => uno.center - otro.center);
  if (juntos.length === 0) return null;

  // Se junta en el orden en que estaban y se sacan los grupos de dígitos.
  const texto = juntos.map((dato) => dato.texto).join(' ');
  const grupos = texto.match(/\d+/g);
  if (!grupos || grupos.length < 3) return null;

  // Con exactamente tres, no hay duda.
  let tres = grupos.slice(0, 3);

  if (grupos.length > 3) {
    // Con más, la lectura no es fiable: una barra confundida con un 1 mete un
    // número de más y colocarlos a ciegas daría un K/D/A inventado.
    const separadores = (texto.match(/\//g) || []).length;
    if (separadores !== 2) return null;
    // Con las dos barras bien leídas se puede repartir por ellas.
    const porBarra = texto.split('/').map((trozo) => (trozo.match(/\d+/g) || []));
    if (porBarra.length !== 3 || porBarra.some((trozo) => trozo.length !== 1)) return null;
    tres = porBarra.map((trozo) => trozo[0]);
  }

  for (const dato of juntos) dato.usado = true;
  return {
    kills: numero(tres[0]),
    deaths: numero(tres[1]),
    assists: numero(tres[2])
  };
}

/**
 * Junta las líneas que en realidad son una sola fila.
 *
 * En el cliente cada jugador ocupa dos renglones: el nombre arriba y el agente
 * debajo. Si se leen por separado, el agente pasa por otro jugador y la tabla
 * sale con veinte filas.
 */
function mergeContinuationLines(lines, { esContinuacion }) {
  const filas = [];

  for (const linea of lines) {
    const anterior = filas[filas.length - 1];
    const separacion = anterior
      ? linea.bbox.y0 - anterior.bbox.y1
      : Infinity;
    const altoLinea = Math.max(1, linea.bbox.y1 - linea.bbox.y0);

    // Sólo se pega si va pegada de verdad: si no, se juntarían filas distintas.
    if (anterior && separacion < altoLinea * 0.9 && esContinuacion(linea, anterior)) {
      anterior.words = [...anterior.words, ...linea.words];
      anterior.text = `${anterior.text} ${linea.text}`;
      anterior.bbox = {
        x0: Math.min(anterior.bbox.x0, linea.bbox.x0),
        y0: Math.min(anterior.bbox.y0, linea.bbox.y0),
        x1: Math.max(anterior.bbox.x1, linea.bbox.x1),
        y1: Math.max(anterior.bbox.y1, linea.bbox.y1)
      };
      anterior.continuation = [...(anterior.continuation || []), linea.words];
      continue;
    }
    filas.push({ ...linea, words: [...linea.words] });
  }

  return filas;
}

module.exports = {
  findHeader, nameLimit, nameColumnStart, readRow, mergeContinuationLines, numero, esNumero,
  anchoDe, centroX, centroY, alto, normalizeHeader
};
