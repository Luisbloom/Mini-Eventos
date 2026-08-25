'use strict';

/**
 * Genera capturas sintéticas para las pruebas.
 *
 * No se parecen a Valorant: sirven para comprobar que la cadena
 * imagen -> Tesseract -> palabras -> parser está conectada de verdad, y para
 * tener PNG/JPEG/WebP válidos con los que probar la subida.
 *
 * El perfil visual real —fuentes, colores, posiciones— se calibra cuando haya
 * una captura de verdad; la arquitectura no cambia por eso.
 */

const sharp = require('sharp');

const ANCHO = 1280;
const MARGEN = 40;
const ALTO_LINEA = 46;
/** Lo que ocupa un carácter con la fuente y el tamaño que se usan al dibujar. */
const ANCHO_CARACTER = 18.2;

function escapeXml(valor) {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Dibuja las líneas en texto monoespaciado negro sobre blanco: es lo más fácil
 * de leer para un OCR, que es justo lo que queremos comprobar aquí.
 *
 * @param {string[]} lineas
 */
async function renderScreenshot(lineas, { format = 'png', width = null } = {}) {
  // El lienzo se ajusta a la línea más larga. Con un ancho fijo, una tabla con
  // muchas columnas se sale por la derecha y el OCR nunca ve la última: parece
  // un fallo del parser cuando en realidad falta media imagen.
  const masLarga = Math.max(0, ...lineas.map((linea) => String(linea).length));
  const ancho = width ?? Math.max(ANCHO, MARGEN * 2 + Math.ceil(masLarga * ANCHO_CARACTER));
  const alto = MARGEN * 2 + lineas.length * ALTO_LINEA;
  const textos = lineas.map((linea, indice) => {
    const y = MARGEN + (indice + 1) * ALTO_LINEA - 12;
    return `<text x="${MARGEN}" y="${y}" font-family="DejaVu Sans Mono, Courier New, monospace" `
      + `font-size="30" fill="#000000" xml:space="preserve">${escapeXml(linea)}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    ${textos}
  </svg>`;

  const imagen = sharp(Buffer.from(svg));
  if (format === 'jpeg' || format === 'jpg') return imagen.jpeg({ quality: 95 }).toBuffer();
  if (format === 'webp') return imagen.webp({ quality: 95 }).toBuffer();
  return imagen.png().toBuffer();
}

/** Una captura estilo resumen de partida, con marcador y tabla de jugadores. */
const PARTIDA_DE_MUESTRA = Object.freeze({
  map: 'ASCENT',
  teamA: { name: 'LOS FILTRADORES', rounds: 13 },
  teamB: { name: 'CHORIZO POWER', rounds: 8 },
  players: [
    { name: 'Sella#NANO', agent: 'Raze', acs: 287, k: 24, d: 16, a: 5 },
    { name: 'ChoripanXd#EUW', agent: 'Jett', acs: 241, k: 20, d: 17, a: 3 },
    { name: 'JUANXULO#LAT', agent: 'Omen', acs: 198, k: 15, d: 18, a: 9 },
    { name: 'chuche#JART', agent: 'Sage', acs: 165, k: 11, d: 19, a: 12 },
    { name: 'Alvlp10#ALV', agent: 'Sova', acs: 154, k: 10, d: 18, a: 8 },
    { name: 'MontesOnFi#ESP', agent: 'Reyna', acs: 233, k: 19, d: 20, a: 4 },
    { name: 'CrisTina#NANO', agent: 'Killjoy', acs: 187, k: 14, d: 21, a: 7 },
    { name: 'Marcutis20#MAR', agent: 'Skye', acs: 172, k: 13, d: 20, a: 10 },
    { name: 'RabanoRojo#JART', agent: 'Cypher', acs: 149, k: 9, d: 22, a: 6 },
    { name: 'RobbieUre#ROB', agent: 'Breach', acs: 131, k: 8, d: 21, a: 11 }
  ]
});

/** Las líneas de texto de esa captura, para el OCR falso y para dibujarla. */
function postMatchLines(partida = PARTIDA_DE_MUESTRA) {
  const columna = (valor, ancho) => String(valor).padEnd(ancho);
  return [
    'VALORANT COMPETITIVE',
    partida.map,
    `${partida.teamA.name}  ${partida.teamA.rounds}`,
    `${partida.teamB.name}  ${partida.teamB.rounds}`,
    '',
    `${columna('PLAYER', 20)}${columna('AGENT', 10)}${columna('ACS', 6)}${columna('K', 5)}${columna('D', 5)}A`,
    ...partida.players.map((jugador) =>
      `${columna(jugador.name, 20)}${columna(jugador.agent, 10)}${columna(jugador.acs, 6)}`
      + `${columna(jugador.k, 5)}${columna(jugador.d, 5)}${jugador.a}`)
  ];
}

/**
 * Dibuja palabras EN SUS COORDENADAS, no reflowadas a texto monoespaciado.
 *
 * Reflowar pierde justo lo que el parser necesita: en qué columna cae cada
 * número. Una imagen así se lee mal y parece un fallo del parser cuando lo que
 * falla es el dibujo.
 */
async function renderWords(words, { format = 'png', padding = 40, scale = 1 } = {}) {
  const ancho = Math.ceil(Math.max(...words.map((p) => p.bbox.x1)) * scale) + padding * 2;
  const alto = Math.ceil(Math.max(...words.map((p) => p.bbox.y1)) * scale) + padding * 2;

  const textos = words.map((palabra) => {
    const x = (palabra.bbox.x0 * scale + padding).toFixed(1);
    const y = (palabra.bbox.y1 * scale + padding).toFixed(1);
    // El tamaño sale de la altura de la caja: así las etiquetas pequeñas del
    // Riot ID salen pequeñas, como en la captura de verdad.
    const tam = Math.max(11, (palabra.bbox.y1 - palabra.bbox.y0) * scale * 0.92).toFixed(1);
    return '<text x="' + x + '" y="' + y + '" '
      + 'font-family="DejaVu Sans, Arial, sans-serif" font-size="' + tam + '" '
      + 'fill="#111111" xml:space="preserve">' + escapeXml(palabra.text) + '</text>';
  }).join('\n');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + ancho + '" height="' + alto + '">'
    + '<rect width="100%" height="100%" fill="#ffffff"/>'
    + textos + '</svg>';

  const imagen = sharp(Buffer.from(svg));
  if (format === 'jpeg' || format === 'jpg') return imagen.jpeg({ quality: 95 }).toBuffer();
  if (format === 'webp') return imagen.webp({ quality: 95 }).toBuffer();
  return imagen.png().toBuffer();
}

module.exports = { renderScreenshot, renderWords, postMatchLines, PARTIDA_DE_MUESTRA };
