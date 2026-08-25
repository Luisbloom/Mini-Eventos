'use strict';

/**
 * De texto reconocido a datos de una partida.
 *
 * Regla que gobierna todo esto: **si un dato no está visible, es null, no cero**.
 * Un 0 inventado en ADR contamina la media del torneo y nadie vuelve a saber si
 * ese jugador hizo cero daño o si la captura no traía la columna.
 *
 * Hay dos interfaces reales y no se parecen:
 *
 * - El **cliente de Valorant** enseña la pantalla en el idioma de quien juega,
 *   pone el nombre y el agente en dos renglones, junta K/D/A en una celda y
 *   ordena las diez filas por rendimiento, **mezclando los equipos**.
 * - **Tracker** separa Team A y Team B, trae muchas más columnas y pone la
 *   etiqueta del Riot ID aparte, en pequeño y en gris.
 *
 * Ninguna de las dos se lee buscando cadenas en el texto plano: se usan las
 * cajas de cada palabra, porque `text.includes('13')` encuentra el 13 de un ACS
 * de 130.
 */

const { KINDS } = require('./classify');
const {
  findHeader, nameLimit, readRow, mergeContinuationLines, numero, esNumero,
  anchoDe, centroX, alto, normalizeHeader
} = require('./layout');

/** Nombres de mapa que puede llevar una captura. */
const MAP_NAMES = Object.freeze({
  ascent: 'Ascent', bind: 'Bind', breeze: 'Breeze', fracture: 'Fracture',
  haven: 'Haven', icebox: 'Icebox', lotus: 'Lotus', pearl: 'Pearl',
  split: 'Split', sunset: 'Sunset', abyss: 'Abyss', corrode: 'Corrode'
});

const AGENTS = Object.freeze([
  'Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade',
  'Gekko', 'Harbor', 'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Neon', 'Omen', 'Phoenix',
  'Raze', 'Reyna', 'Sage', 'Skye', 'Sova', 'Tejo', 'Viper', 'Vyse', 'Waylay', 'Yoru'
]);

const AGENTES_NORMALIZADOS = new Map(AGENTS.map((agente) => [normalizeHeader(agente), agente]));

/** Se mantiene por compatibilidad: la tabla viva está en columns.js. */
const { COLUMN_ALIASES: COLUMNS } = require('./columns');

const VACIO = Object.freeze({
  map: null, teamARounds: null, teamBRounds: null, scorePair: null,
  teamNames: [], players: []
});

// ------------------------------------------------------------------ utilidades

/** Riot ID completo: gameName#tagLine. */
const RIOT_ID = /^(.+?)#([A-Za-z0-9]{2,6})$/;
/** Una etiqueta suelta, con o sin almohadilla. */
const TAG_SUELTO = /^#?([A-Za-z0-9]{2,6})$/;

function partirRiotId(bruto) {
  const encontrado = RIOT_ID.exec(String(bruto || '').trim());
  if (!encontrado) return { gameName: String(bruto || '').trim(), tagLine: null, riotId: null };
  return {
    gameName: encontrado[1].trim(),
    tagLine: encontrado[2],
    riotId: `${encontrado[1].trim()}#${encontrado[2]}`
  };
}

function buscarMapa(texto) {
  const mayusculas = normalizeHeader(texto);
  for (const [clave, nombre] of Object.entries(MAP_NAMES)) {
    if (new RegExp(`\\b${nombre.toUpperCase()}\\b`).test(mayusculas)) {
      return { key: clave, name: nombre };
    }
  }
  return null;
}

function buscarAgente(palabras) {
  for (const palabra of palabras) {
    const encontrado = AGENTES_NORMALIZADOS.get(normalizeHeader(palabra));
    if (encontrado) return encontrado;
  }
  return null;
}

const esAgente = (texto) => AGENTES_NORMALIZADOS.has(normalizeHeader(texto));

/**
 * Reconstruye el Riot ID cuando el nombre y la etiqueta llegan por separado.
 *
 * En Tracker la etiqueta va al lado, más pequeña y en gris, así que el OCR la
 * devuelve como otra palabra. Se pega sólo si va pegada de verdad y tiene forma
 * de etiqueta: cualquier texto pequeño cercano no vale, o acabaríamos metiendo
 * el rango o una columna dentro del nombre.
 */
function reconstruirRiotId(palabras, ancho) {
  if (palabras.length === 0) return { raw: '', ...partirRiotId('') };

  const ordenadas = [...palabras].sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
  const junto = ordenadas.map((p) => p.text).join(' ');

  // Si ya viene entero, no hay nada que reconstruir.
  const directo = partirRiotId(junto.replace(/\s*#\s*/, '#'));
  if (directo.riotId) return { raw: junto, ...directo };

  const ultima = ordenadas[ordenadas.length - 1];
  const anterior = ordenadas[ordenadas.length - 2];
  const posibleTag = TAG_SUELTO.exec(ultima.text);

  if (posibleTag && anterior) {
    const separacion = ultima.bbox.x0 - anterior.bbox.x1;
    const masPequena = alto(ultima) <= alto(anterior) * 1.15;
    const lleveAlmohadilla = ultima.text.startsWith('#');
    // Con almohadilla basta; sin ella hay que exigir que esté pegada y en
    // letra más pequeña, o un número de una columna se colaría como etiqueta.
    const pegada = separacion >= 0 && separacion < ancho * 0.02;
    if (lleveAlmohadilla || (pegada && masPequena && !esNumero(ultima.text))) {
      const nombre = ordenadas.slice(0, -1).map((p) => p.text).join(' ').trim();
      if (nombre) {
        return {
          raw: `${nombre}#${posibleTag[1]}`,
          gameName: nombre,
          tagLine: posibleTag[1],
          riotId: `${nombre}#${posibleTag[1]}`
        };
      }
    }
  }

  return { raw: junto, gameName: junto, tagLine: null, riotId: null };
}

/**
 * Las palabras de una fila que están a la izquierda de la primera columna.
 *
 * La frontera incluye las cabeceras que no traen datos, como «Current Rank»:
 * sin eso, el rango del jugador se pegaría a su nombre y el Riot ID no se
 * reconstruiría nunca.
 */
function palabrasDeNombre(linea, cabecera) {
  const limite = nameLimit(cabecera);
  return linea.words
    .filter((palabra) => centroX(palabra) < limite)
    .sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
}

// --------------------------------------------------------------- marcadores

/** «13 : 10», «13 - 10» o dos números sueltos con algo en medio. */
function parMarcador(texto) {
  const limpio = String(texto || '');
  const conSeparador = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/.exec(limpio);
  if (conSeparador) return [Number(conSeparador[1]), Number(conSeparador[2])];
  // «10 DERROTA 13» / «13 VICTORY 10»
  const conPalabra = /\b(\d{1,2})\b[^\d]{2,30}?\b(\d{1,2})\b/.exec(limpio);
  if (conPalabra) return [Number(conPalabra[1]), Number(conPalabra[2])];
  return null;
}

/** Un marcador creíble: alguien llegó a la meta y no hay empate. */
const marcadorPlausible = (par) =>
  Array.isArray(par) && par[0] !== par[1] && Math.max(...par) >= 13 && Math.min(...par) >= 0
  && Math.max(...par) <= 40;

// ============================================================ CLIENTE VALORANT

/**
 * La pantalla de puntuaciones del cliente.
 *
 * Dos cosas que hay que tener presentes y que no son evidentes:
 *
 * 1. Las filas están **ordenadas por rendimiento, no por equipo**. Dar por hecho
 *    que los cinco primeros son un equipo mete a media plantilla en el bando
 *    equivocado.
 * 2. El marcador («10 DERROTA 13») está desde el punto de vista de quien jugó,
 *    así que **no dice qué equipo del torneo hizo 13**. Se devuelve como par sin
 *    orientar y lo orienta otra fuente.
 */
function parseValorantScoreboard(ocr) {
  const lines = ocr.lines || [];
  const ancho = anchoDe(lines);
  const cabecera = findHeader(lines);
  if (!cabecera) return { ...VACIO, kind: KINDS.VALORANT_SCOREBOARD };

  // El marcador está por encima de la tabla.
  let par = null;
  for (const linea of lines.slice(0, cabecera.index)) {
    const candidato = parMarcador(linea.text);
    if (marcadorPlausible(candidato)) { par = candidato; break; }
  }

  // Nombre y agente van en dos renglones: se juntan antes de leer la tabla.
  const filas = mergeContinuationLines(lines.slice(cabecera.index + 1), {
    esContinuacion: (linea) =>
      linea.words.length <= 3 && linea.words.every((palabra) => !esNumero(palabra.text))
      && (linea.words.some((palabra) => esAgente(palabra.text)) || linea.words.length === 1)
  });

  const jugadores = [];
  for (const fila of filas) {
    const stats = readRow(fila, cabecera, ancho);
    // Sin ACS ni bajas no es una fila de jugador: será un pie de tabla.
    if (stats.acs === undefined && stats.kills === undefined) continue;

    const nombre = palabrasDeNombre(fila, cabecera);
    const identidad = reconstruirRiotId(
      nombre.filter((palabra) => !esAgente(palabra.text)), ancho);
    if (!identidad.gameName) continue;

    jugadores.push({
      ...identidad,
      agent: buscarAgente(nombre.map((palabra) => palabra.text))
        ?? buscarAgente(fila.words.map((palabra) => palabra.text)),
      // El cliente no separa equipos: quién juega con quién sale del roster.
      visualTeam: null,
      confidence: fila.confidence / 100,
      ...stats
    });
  }

  return {
    kind: KINDS.VALORANT_SCOREBOARD,
    map: buscarMapa(ocr.text),
    // Sin orientar a propósito: esta pantalla no sabe qué lado es cuál.
    teamARounds: null,
    teamBRounds: null,
    scorePair: par,
    teamNames: [],
    players: jugadores
  };
}

// ==================================================================== TRACKER

/** Las cabeceras de equipo de Tracker: «Team A • Avg. Rank: Silver I». */
const CABECERA_EQUIPO = /\bTEAM\s*([AB])\b/;

/**
 * La pantalla de partida de Tracker.
 *
 * Sí separa los dos equipos, así que es la que **orienta el marcador**. Cada
 * fila se queda con el lado en el que estaba (`visualTeam`), pero ese lado no es
 * autoridad: que Tracker llame «Team A» a un bando no dice cuál de los dos
 * equipos del torneo es. Eso lo resuelve después el roster.
 */
function parseTrackerMatch(ocr) {
  const lines = ocr.lines || [];
  const ancho = anchoDe(lines);
  const cabecera = findHeader(lines);

  const mapa = buscarMapa(ocr.text);

  // El marcador va con los nombres de los equipos, arriba.
  let par = null;
  const limite = cabecera ? cabecera.index : lines.length;
  for (const linea of lines.slice(0, limite)) {
    const candidato = parMarcador(linea.text);
    if (marcadorPlausible(candidato)) { par = candidato; break; }
  }

  if (!cabecera) {
    return {
      kind: KINDS.TRACKER_MATCH, map: mapa,
      teamARounds: par ? par[0] : null, teamBRounds: par ? par[1] : null,
      scorePair: par, teamNames: [], players: []
    };
  }

  const jugadores = [];
  let ladoActual = null;

  for (const linea of lines.slice(cabecera.index + 1)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion) { ladoActual = seccion[1]; continue; }

    const stats = readRow(linea, cabecera, ancho);
    if (stats.acs === undefined && stats.kills === undefined) continue;

    const nombre = palabrasDeNombre(linea, cabecera);
    const identidad = reconstruirRiotId(nombre, ancho);
    if (!identidad.gameName) continue;

    jugadores.push({
      ...identidad,
      agent: buscarAgente(linea.words.map((palabra) => palabra.text)),
      visualTeam: ladoActual,
      confidence: linea.confidence / 100,
      ...stats
    });
  }

  // Si las cabeceras de equipo están por encima de la tabla, se reparte por
  // mitades: cinco y cinco, en el orden en que aparecen.
  if (jugadores.length === 10 && jugadores.every((jugador) => !jugador.visualTeam)) {
    const lados = ladosPorCabeceraPrevia(lines, cabecera.index);
    if (lados) {
      jugadores.forEach((jugador, indice) => { jugador.visualTeam = indice < 5 ? lados[0] : lados[1]; });
    }
  }

  return {
    kind: KINDS.TRACKER_MATCH,
    map: mapa,
    // Tracker sí orienta: su Team A es el primer número.
    teamARounds: par ? par[0] : null,
    teamBRounds: par ? par[1] : null,
    scorePair: par,
    teamNames: nombresDeEquipo(lines, cabecera.index),
    players: jugadores
  };
}

function ladosPorCabeceraPrevia(lines, hasta) {
  const encontrados = [];
  for (const linea of lines.slice(0, hasta)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion && !encontrados.includes(seccion[1])) encontrados.push(seccion[1]);
  }
  return encontrados.length === 2 ? encontrados : null;
}

function nombresDeEquipo(lines, hasta) {
  const nombres = [];
  for (const linea of lines.slice(0, hasta)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion) nombres.push(`Team ${seccion[1]}`);
  }
  return nombres;
}

// ============================================== resumen genérico (sintéticos)

/**
 * El resumen de fin de partida sin más señas: se lee como el scoreboard, pero
 * aceptando además que el marcador venga como dos líneas de «EQUIPO n».
 */
function parseValorantPostMatch(ocr) {
  const leido = parseValorantScoreboard(ocr);
  const lines = ocr.lines || [];
  const cabecera = findHeader(lines);
  const hasta = cabecera ? cabecera.index : lines.length;

  let par = leido.scorePair;
  const equipos = [];

  if (!par) {
    for (const linea of lines.slice(0, hasta)) {
      const ultima = linea.words[linea.words.length - 1];
      const valor = numero(ultima?.text);
      if (valor === null || linea.words.length < 2) continue;
      const nombre = linea.words.slice(0, -1).map((p) => p.text).join(' ').trim();
      if (!nombre || buscarMapa(nombre)) continue;
      equipos.push({ name: nombre, rounds: valor });
    }
    if (equipos.length >= 2) par = [equipos[0].rounds, equipos[1].rounds];
  }

  return {
    ...leido,
    kind: KINDS.VALORANT_POST_MATCH,
    // Estas capturas tampoco orientan por sí solas, pero cuando traen los
    // nombres de los equipos el marcador ya viene en su orden.
    teamARounds: equipos.length >= 2 && par ? par[0] : null,
    teamBRounds: equipos.length >= 2 && par ? par[1] : null,
    scorePair: par,
    teamNames: equipos.map((equipo) => equipo.name)
  };
}

const PARSERS = Object.freeze({
  [KINDS.VALORANT_POST_MATCH]: parseValorantPostMatch,
  [KINDS.VALORANT_SCOREBOARD]: parseValorantScoreboard,
  [KINDS.TRACKER_MATCH]: parseTrackerMatch
});

/** Aplica el parser que toque. UNKNOWN no se adivina: se devuelve vacío. */
function parseCapture(kind, ocr) {
  const parser = PARSERS[kind];
  if (!parser) return { kind: KINDS.UNKNOWN, ...VACIO };
  return parser(ocr);
}

module.exports = {
  parseCapture, parseValorantPostMatch, parseValorantScoreboard, parseTrackerMatch,
  partirRiotId, reconstruirRiotId, buscarMapa, buscarAgente, numero,
  parMarcador, marcadorPlausible,
  encontrarCabecera: findHeader,
  MAP_NAMES, AGENTS, COLUMNS
};
