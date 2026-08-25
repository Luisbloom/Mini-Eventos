'use strict';

/**
 * La partida real de Bind, tal y como se ve en las dos pantallas.
 *
 * ⚠️ Estos fixtures reproducen el **layout** de cada interfaz —dónde cae cada
 * palabra, qué columnas hay, cómo se parte el Riot ID, en qué orden salen las
 * filas— para poder probar el parser sin arrancar Tesseract veinte veces.
 *
 * NO sustituyen a la calibración con los PNG reales: reproducen lo que se ve,
 * no cómo lo lee el motor. Los valores esperados salen de la partida de verdad
 * y por eso sirven de regresión: si un cambio en el parser los rompe, algo se
 * ha estropeado.
 */

const MATCH = Object.freeze({
  map: 'Bind',
  mapKey: 'bind',
  duration: '41m 25s',
  mode: 'Normal',
  // Orientado como lo enseña Tracker: su Team A ganó.
  trackerTeamARounds: 13,
  trackerTeamBRounds: 10,
  // El cliente lo enseña desde el jugador local, que perdió.
  clientScoreLine: '10 DERROTA 13'
});

/**
 * Team A de Tracker (ganador) y Team B (perdedor).
 * `acsClient` es lo que enseña el cliente; `acs` lo que enseña Tracker. Difieren
 * en 1 en varios: redondean distinto.
 */
const TEAM_A = Object.freeze([
  { name: 'GreenElena', tag: '1409', agent: 'Cypher', acs: 357, acsClient: 357, k: 28, d: 9, a: 7, plusMinus: 19, kd: 3.1, dd: 166, adr: 248.8, hs: 23, kast: 70, fk: 3, fd: 2, mk: 5, economy: 116, plants: 1, defuses: 2 },
  { name: 'Hakai Shin Sella', tag: null, agent: 'Reyna', acs: 326, acsClient: 325, k: 27, d: 15, a: 2, plusMinus: 12, kd: 1.8, dd: 75, adr: 203.1, hs: 34, kast: 65, fk: 4, fd: 2, mk: 5, economy: 83, plants: 1, defuses: 2 },
  { name: 'tilofuro', tag: null, agent: 'Viper', acs: 286, acsClient: 285, k: 23, d: 14, a: 5, plusMinus: 9, kd: 1.6, dd: 59, adr: 175.3, hs: 17, kast: 74, fk: 3, fd: 2, mk: 2, economy: 80, plants: 1, defuses: 0 },
  { name: 'Pamari18', tag: 'EUW', agent: 'Gekko', acs: 59, acsClient: 58, k: 3, d: 18, a: 3, plusMinus: -15, kd: 0.2, dd: -88, adr: 45.4, hs: 9, kast: 52, fk: 0, fd: 2, mk: 0, economy: 20, plants: 6, defuses: 0 },
  { name: 'Alvlp10', tag: null, agent: 'Sage', acs: 35, acsClient: 34, k: 2, d: 19, a: 1, plusMinus: -17, kd: 0.1, dd: -111, adr: 31.2, hs: 15, kast: 39, fk: 0, fd: 5, mk: 0, economy: 12, plants: 0, defuses: 0 }
]);

const TEAM_B = Object.freeze([
  { name: 'AlbertoYT19', tag: '9047', agent: 'Iso', acs: 353, acsClient: 352, k: 30, d: 15, a: 3, plusMinus: 15, kd: 2.0, dd: 91, adr: 215.2, hs: 20, kast: 83, fk: 5, fd: 1, mk: 2, economy: 92, plants: 0, defuses: 1 },
  { name: 'salmongradas', tag: null, agent: 'Cypher', acs: 230, acsClient: 230, k: 19, d: 18, a: 3, plusMinus: 1, kd: 1.1, dd: -23, adr: 144.5, hs: 19, kast: 70, fk: 3, fd: 2, mk: 1, economy: 52, plants: 1, defuses: 2 },
  { name: 'Luisbloom', tag: 'NANO', agent: 'Gekko', acs: 213, acsClient: 212, k: 18, d: 15, a: 1, plusMinus: 3, kd: 1.2, dd: -5, adr: 129.6, hs: 19, kast: 78, fk: 2, fd: 3, mk: 1, economy: 57, plants: 7, defuses: 0 },
  { name: 'choripanXd343', tag: null, agent: 'Brimstone', acs: 89, acsClient: 88, k: 6, d: 18, a: 5, plusMinus: -12, kd: 0.3, dd: -77, adr: 69.6, hs: 20, kast: 48, fk: 2, fd: 3, mk: 1, economy: 27, plants: 0, defuses: 0 },
  { name: 'MontesOnFire', tag: 'EUW', agent: 'Sage', acs: 54, acsClient: 54, k: 2, d: 17, a: 3, plusMinus: -15, kd: 0.1, dd: -86, adr: 44.4, hs: 12, kast: 48, fk: 1, fd: 1, mk: 0, economy: 21, plants: 0, defuses: 0 }
]);

/** El cliente ordena por rendimiento y **mezcla los dos equipos**. */
const CLIENT_ORDER = Object.freeze([
  'GreenElena', 'AlbertoYT19', 'Hakai Shin Sella', 'tilofuro', 'salmongradas',
  'Luisbloom', 'choripanXd343', 'Pamari18', 'MontesOnFire', 'Alvlp10'
]);

// --------------------------------------------------------------- generadores

const ALTO_LINEA = 40;
const ALTO_TEXTO = 26;

/** Una palabra con su caja, en las unidades en que trabaja el parser. */
function palabra(texto, x, y, { escala = 15, altoTexto = ALTO_TEXTO } = {}) {
  return {
    text: String(texto),
    confidence: 92,
    bbox: { x0: x, y0: y, x1: x + String(texto).length * escala, y1: y + altoTexto }
  };
}

/** Coloca palabras en columnas con centro conocido, como una tabla de verdad. */
function fila(y, celdas, opciones = {}) {
  return celdas
    .filter((celda) => celda.text !== null && celda.text !== undefined && celda.text !== '')
    .map((celda) => {
      const ancho = String(celda.text).length * (celda.escala ?? opciones.escala ?? 15);
      // `x` es el centro de la columna: el texto se centra en ella.
      const x0 = celda.left !== undefined ? celda.left : celda.x - ancho / 2;
      return {
        text: String(celda.text),
        confidence: celda.confidence ?? 92,
        bbox: { x0, y0: y, x1: x0 + ancho, y1: y + (celda.altoTexto ?? ALTO_TEXTO) }
      };
    });
}

// ============================================================ TRACKER

/** Dónde cae cada columna en la pantalla de Tracker. */
const TRACKER_COLS = Object.freeze({
  rank: 620, acs: 760, k: 850, d: 930, a: 1010, plusMinus: 1100,
  kd: 1190, dd: 1290, adr: 1400, hs: 1500, kast: 1600, fk: 1690, fd: 1770, mk: 1850
});

/**
 * Reproduce la pantalla de partida de Tracker.
 *
 * Detalles que importan y que el fixture sintético no tenía: no aparece la
 * cadena «tracker.gg» por ninguna parte, las etiquetas del Riot ID van aparte y
 * en letra más pequeña, y los dos equipos están separados por sus cabeceras.
 */
function trackerWords({ teamARounds = MATCH.trackerTeamARounds, teamBRounds = MATCH.trackerTeamBRounds, map = MATCH.map } = {}) {
  const words = [];
  let y = 40;

  words.push(...fila(y, [
    { text: MATCH.mode, left: 60 }, { text: map, left: 200 },
    { text: 'Average', left: 1500 }, { text: 'Rank', left: 1620 },
    { text: 'Silver', left: 1700 }, { text: 'I', left: 1790 }
  ]));
  y += ALTO_LINEA;

  // Team A  13 : 10  Team B, con la duración al lado.
  words.push(...fila(y, [
    { text: 'Team', left: 300 }, { text: 'A', left: 380 },
    { text: String(teamARounds), left: 460 }, { text: ':', left: 510 },
    { text: String(teamBRounds), left: 550 },
    { text: 'Team', left: 620 }, { text: 'B', left: 700 },
    { text: MATCH.duration, left: 820 }
  ]));
  y += ALTO_LINEA * 2;

  words.push(...fila(y, [
    { text: 'Scoreboard', left: 60 }, { text: 'Performance', left: 250 },
    { text: 'Economy', left: 480 }, { text: 'Rounds', left: 650 }, { text: 'Duels', left: 790 }
  ]));
  y += ALTO_LINEA * 2;

  const cabecera = () => {
    const celdas = [
      { text: 'Current', left: 540 }, { text: 'Rank', left: 640 },
      { text: 'ACS', x: TRACKER_COLS.acs }, { text: 'K', x: TRACKER_COLS.k },
      { text: 'D', x: TRACKER_COLS.d }, { text: 'A', x: TRACKER_COLS.a },
      { text: '+/-', x: TRACKER_COLS.plusMinus }, { text: 'K/D', x: TRACKER_COLS.kd },
      { text: 'DDΔ', x: TRACKER_COLS.dd }, { text: 'ADR', x: TRACKER_COLS.adr },
      { text: 'HS%', x: TRACKER_COLS.hs }, { text: 'KAST', x: TRACKER_COLS.kast },
      { text: 'FK', x: TRACKER_COLS.fk }, { text: 'FD', x: TRACKER_COLS.fd },
      { text: 'MK', x: TRACKER_COLS.mk }
    ];
    return fila(y, celdas);
  };

  const filaJugador = (jugador) => {
    const celdas = [
      { text: jugador.name, left: 120 },
      // La etiqueta va justo al lado y en letra más pequeña.
      ...(jugador.tag
        ? [{ text: `#${jugador.tag}`, left: 120 + jugador.name.length * 15 + 8, escala: 11, altoTexto: 20 }]
        : []),
      { text: 'Silver', x: TRACKER_COLS.rank },
      { text: jugador.acs, x: TRACKER_COLS.acs },
      { text: jugador.k, x: TRACKER_COLS.k },
      { text: jugador.d, x: TRACKER_COLS.d },
      { text: jugador.a, x: TRACKER_COLS.a },
      { text: (jugador.plusMinus > 0 ? '+' : '') + jugador.plusMinus, x: TRACKER_COLS.plusMinus },
      { text: jugador.kd.toFixed(1), x: TRACKER_COLS.kd },
      { text: (jugador.dd > 0 ? '+' : '') + jugador.dd, x: TRACKER_COLS.dd },
      { text: jugador.adr.toFixed(1), x: TRACKER_COLS.adr },
      { text: `${jugador.hs}%`, x: TRACKER_COLS.hs },
      { text: `${jugador.kast}%`, x: TRACKER_COLS.kast },
      { text: jugador.fk, x: TRACKER_COLS.fk },
      { text: jugador.fd, x: TRACKER_COLS.fd },
      { text: jugador.mk, x: TRACKER_COLS.mk }
    ];
    return fila(y, celdas);
  };

  words.push(...cabecera());
  y += ALTO_LINEA;

  for (const [lado, equipo] of [['A', TEAM_A], ['B', TEAM_B]]) {
    words.push(...fila(y, [
      { text: 'Team', left: 60 }, { text: lado, left: 140 },
      { text: '•', left: 180 }, { text: 'Avg.', left: 220 },
      { text: 'Rank:', left: 290 }, { text: 'Silver', left: 380 }, { text: 'I', left: 470 }
    ]));
    y += ALTO_LINEA;

    for (const jugador of equipo) {
      words.push(...filaJugador(jugador));
      y += ALTO_LINEA;
    }
    y += ALTO_LINEA / 2;
  }

  return words;
}

// ============================================================ CLIENTE

/** Dónde cae cada columna en la pantalla de puntuaciones del cliente. */
const CLIENT_COLS = Object.freeze({
  acs: 900, kda: 1120, economy: 1330, firstBloods: 1520, plants: 1700, defuses: 1870
});

/**
 * Reproduce la pantalla de puntuaciones del cliente, en español.
 *
 * Dos cosas que rompen los supuestos fáciles: el nombre y el agente van en
 * renglones distintos, y las diez filas están **ordenadas por rendimiento**, con
 * los dos equipos mezclados.
 */
function clientWords({ scoreLine = MATCH.clientScoreLine } = {}) {
  const todos = [...TEAM_A, ...TEAM_B];
  const porNombre = new Map(todos.map((jugador) => [jugador.name, jugador]));
  const words = [];
  let y = 40;

  const partes = scoreLine.split(/\s+/);
  words.push(...fila(y, [
    { text: partes[0], left: 700 }, { text: partes[1], left: 800 }, { text: partes[2], left: 1000 }
  ]));
  y += ALTO_LINEA * 2;

  words.push(...fila(y, [
    { text: 'RESUMEN', left: 60 }, { text: 'PUNTUACIONES', left: 260 }, { text: 'RONDAS', left: 560 }
  ]));
  y += ALTO_LINEA * 2;

  words.push(...fila(y, [
    { text: 'ORDENADO', left: 100 }, { text: 'DE', left: 250 },
    { text: 'FORMA', left: 300 }, { text: 'INDIVIDUAL', left: 400 },
    { text: 'PUNT.', x: CLIENT_COLS.acs - 60 }, { text: 'MED.', x: CLIENT_COLS.acs },
    { text: 'COMBATE', x: CLIENT_COLS.acs + 70 },
    { text: 'AMA', x: CLIENT_COLS.kda },
    { text: 'ECONOMÍA', x: CLIENT_COLS.economy },
    { text: 'PRIMERAS', x: CLIENT_COLS.firstBloods - 40 }, { text: 'SANGRES', x: CLIENT_COLS.firstBloods + 50 },
    { text: 'SPIKES', x: CLIENT_COLS.plants - 40 }, { text: 'COLOCADAS', x: CLIENT_COLS.plants + 50 },
    { text: 'DESACTIVACIONES', x: CLIENT_COLS.defuses }
  ]));
  y += ALTO_LINEA * 2;

  for (const nombre of CLIENT_ORDER) {
    const jugador = porNombre.get(nombre);

    words.push(...fila(y, [
      { text: jugador.name, left: 160 },
      { text: jugador.acsClient, x: CLIENT_COLS.acs },
      { text: String(jugador.k), x: CLIENT_COLS.kda - 55 },
      { text: '/', x: CLIENT_COLS.kda - 25 },
      { text: String(jugador.d), x: CLIENT_COLS.kda },
      { text: '/', x: CLIENT_COLS.kda + 25 },
      { text: String(jugador.a), x: CLIENT_COLS.kda + 55 },
      { text: jugador.economy, x: CLIENT_COLS.economy },
      { text: jugador.fk, x: CLIENT_COLS.firstBloods },
      { text: jugador.plants, x: CLIENT_COLS.plants },
      { text: jugador.defuses, x: CLIENT_COLS.defuses }
    ]));
    // El agente, justo debajo del nombre y en mayúsculas.
    y += ALTO_TEXTO + 4;
    words.push(...fila(y, [{ text: jugador.agent.toUpperCase(), left: 160, escala: 12, altoTexto: 20 }]));
    y += ALTO_LINEA;
  }

  return words;
}

/** El texto plano que acompaña a las palabras, como lo daría un OCR. */
function textFromWords(words) {
  const lineas = new Map();
  for (const palabra of words) {
    const fila = Math.round(palabra.bbox.y0 / 10);
    if (!lineas.has(fila)) lineas.set(fila, []);
    lineas.get(fila).push(palabra);
  }
  return [...lineas.entries()]
    .sort((uno, otro) => uno[0] - otro[0])
    .map(([, palabras]) => palabras
      .sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0)
      .map((palabra) => palabra.text).join(' '))
    .join('\n');
}

/** Un proveedor OCR falso que devuelve estos fixtures. */
function fakeOcrFor(words) {
  return { text: textFromWords(words), words };
}

module.exports = {
  MATCH, TEAM_A, TEAM_B, CLIENT_ORDER,
  trackerWords, clientWords, fakeOcrFor, textFromWords,
  TRACKER_COLS, CLIENT_COLS
};
