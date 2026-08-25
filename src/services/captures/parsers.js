'use strict';

/**
 * De texto reconocido a datos de una partida.
 *
 * Regla que gobierna todo esto: **si un dato no está visible, es null, no cero**.
 * Un 0 inventado en ADR contamina la media del torneo y nadie vuelve a saber si
 * ese jugador hizo cero daño o si la captura no traía la columna.
 *
 * Los parsers trabajan con líneas y cajas, no buscando cadenas por el texto
 * plano: `text.includes('13')` encuentra el 13 de un ACS de 130.
 */

const { KINDS } = require('./classify');

/** Nombres de mapa que puede llevar una captura, en cualquier idioma. */
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

/** Cabeceras que sabemos leer, y a qué campo van. */
const COLUMNS = Object.freeze({
  ACS: 'acs', SCORE: 'acs', 'COMBAT SCORE': 'acs',
  K: 'kills', KILLS: 'kills',
  D: 'deaths', DEATHS: 'deaths',
  A: 'assists', ASSISTS: 'assists',
  ADR: 'adr', DDR: 'adr',
  'HS%': 'hsPercent', HS: 'hsPercent',
  'KAST%': 'kastPercent', KAST: 'kastPercent',
  FK: 'firstKills', FB: 'firstKills',
  FD: 'firstDeaths',
  '+/-': 'plusMinus'
});

const PORCENTAJES = new Set(['hsPercent', 'kastPercent']);

// ------------------------------------------------------------------ utilidades

/** Un número, o null si lo que hay no lo es. Nunca cero por defecto. */
function numero(bruto) {
  if (bruto === null || bruto === undefined) return null;
  const limpio = String(bruto).replace('%', '').replace(',', '.').trim();
  if (limpio === '' || limpio === '-' || limpio === '--') return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : null;
}

/** Riot ID completo: gameName#tagLine. */
const RIOT_ID = /^(.+?)#([A-Za-z0-9]{2,6})$/;

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
  const mayusculas = String(texto || '').toUpperCase();
  for (const [clave, nombre] of Object.entries(MAP_NAMES)) {
    // Con límites de palabra: BIND no debe salir de "BINDING".
    if (new RegExp(`\\b${nombre.toUpperCase()}\\b`).test(mayusculas)) {
      return { key: clave, name: nombre };
    }
  }
  return null;
}

function buscarAgente(palabras) {
  for (const palabra of palabras) {
    const encontrado = AGENTS.find((agente) =>
      agente.toLowerCase() === String(palabra).toLowerCase());
    if (encontrado) return encontrado;
  }
  return null;
}

/**
 * La fila de cabecera: la que trae varios nombres de columna conocidos.
 * Con ella sabemos qué significa cada número de las filas de abajo, en vez de
 * dar por hecho un orden que cambia entre Valorant y Tracker.
 */
function encontrarCabecera(lines) {
  for (const [indice, linea] of lines.entries()) {
    const etiquetas = linea.words
      .map((palabra) => palabra.text.toUpperCase().replace(/[.:]/g, ''))
      .filter((texto) => COLUMNS[texto]);
    if (etiquetas.length >= 3) {
      return {
        index: indice,
        columns: linea.words
          .map((palabra) => ({
            field: COLUMNS[palabra.text.toUpperCase().replace(/[.:]/g, '')] ?? null,
            center: (palabra.bbox.x0 + palabra.bbox.x1) / 2
          }))
          .filter((columna) => columna.field)
      };
    }
  }
  return null;
}

/**
 * Reparte los números de una fila entre las columnas de la cabecera, por
 * cercanía horizontal. Así una captura con las columnas en otro orden se lee
 * igual de bien.
 */
function leerFila(linea, cabecera) {
  const stats = {};
  const numeros = linea.words
    .map((palabra) => ({
      valor: numero(palabra.text),
      center: (palabra.bbox.x0 + palabra.bbox.x1) / 2,
      esPorcentaje: palabra.text.includes('%')
    }))
    .filter((palabra) => palabra.valor !== null);

  for (const columna of cabecera.columns) {
    let mejor = null;
    let distancia = Infinity;
    for (const dato of numeros) {
      if (dato.usado) continue;
      const separacion = Math.abs(dato.center - columna.center);
      if (separacion < distancia) { distancia = separacion; mejor = dato; }
    }
    // Si el número más cercano está lejísimos, esa columna no está en la fila.
    if (mejor && distancia < 140) {
      mejor.usado = true;
      stats[columna.field] = mejor.valor;
    }
  }

  for (const campo of PORCENTAJES) {
    if (stats[campo] !== undefined && (stats[campo] < 0 || stats[campo] > 100)) {
      delete stats[campo];   // un porcentaje imposible es un error de lectura
    }
  }
  return stats;
}

/** Todo lo que parece un marcador «13 - 8» o dos números sueltos en una línea. */
function marcadoresEnLinea(linea) {
  const texto = linea.text;
  const conGuion = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/.exec(texto);
  if (conGuion) return [Number(conGuion[1]), Number(conGuion[2])];
  return null;
}

// -------------------------------------------------------------------- parsers

/**
 * Cada parser recibe el OCR normalizado y devuelve lo que ha podido leer.
 * Ninguno rellena huecos: lo que no ve, no lo inventa.
 */
function parseValorantPostMatch(ocr) {
  const lines = ocr.lines || [];
  const mapa = buscarMapa(ocr.text);
  const cabecera = encontrarCabecera(lines);

  // El marcador: primero un «13 - 8» explícito; si no, las dos líneas con
  // nombre de equipo y un número suelto al final.
  let rounds = null;
  let equipos = [];

  for (const linea of lines.slice(0, cabecera?.index ?? lines.length)) {
    const par = marcadoresEnLinea(linea);
    if (par && par.some((valor) => valor >= 13)) { rounds = par; break; }
  }

  if (!rounds) {
    const candidatas = lines.slice(0, cabecera?.index ?? lines.length)
      .map((linea) => {
        const ultima = linea.words[linea.words.length - 1];
        const valor = numero(ultima?.text);
        if (valor === null || linea.words.length < 2) return null;
        const nombre = linea.words.slice(0, -1).map((p) => p.text).join(' ').trim();
        if (!nombre || buscarMapa(nombre)) return null;
        return { name: nombre, rounds: valor };
      })
      .filter(Boolean);

    if (candidatas.length >= 2) {
      equipos = candidatas.slice(0, 2);
      rounds = [equipos[0].rounds, equipos[1].rounds];
    }
  }

  const jugadores = cabecera ? leerJugadores(lines, cabecera) : [];

  return {
    kind: KINDS.VALORANT_POST_MATCH,
    map: mapa,
    teamARounds: rounds ? rounds[0] : null,
    teamBRounds: rounds ? rounds[1] : null,
    teamNames: equipos.map((equipo) => equipo.name),
    players: jugadores
  };
}

/** El scoreboard de dentro de la partida: mismo formato de tabla, otro marcador. */
function parseValorantScoreboard(ocr) {
  const leido = parseValorantPostMatch(ocr);
  return { ...leido, kind: KINDS.VALORANT_SCOREBOARD };
}

/** Tracker: la misma tabla con más columnas, y el mapa suele ir con el modo. */
function parseTrackerMatch(ocr) {
  const leido = parseValorantPostMatch(ocr);
  return { ...leido, kind: KINDS.TRACKER_MATCH };
}

function leerJugadores(lines, cabecera) {
  const jugadores = [];

  for (const linea of lines.slice(cabecera.index + 1)) {
    const palabras = linea.words.map((palabra) => palabra.text);
    // El nombre es lo que hay antes del primer número o del agente.
    const primerDato = palabras.findIndex((palabra, indice) =>
      indice > 0 && (numero(palabra) !== null
        || AGENTS.some((agente) => agente.toLowerCase() === palabra.toLowerCase())));
    if (primerDato < 1) continue;

    const nombre = palabras.slice(0, primerDato).join(' ').trim();
    if (!nombre) continue;

    const stats = leerFila(linea, cabecera);
    if (Object.keys(stats).length === 0) continue;

    jugadores.push({
      ...partirRiotId(nombre),
      raw: nombre,
      agent: buscarAgente(palabras.slice(primerDato)),
      confidence: linea.confidence / 100,
      ...stats
    });
  }

  return jugadores;
}

const PARSERS = Object.freeze({
  [KINDS.VALORANT_POST_MATCH]: parseValorantPostMatch,
  [KINDS.VALORANT_SCOREBOARD]: parseValorantScoreboard,
  [KINDS.TRACKER_MATCH]: parseTrackerMatch
});

/** Aplica el parser que toque. UNKNOWN no se adivina: se devuelve vacío. */
function parseCapture(kind, ocr) {
  const parser = PARSERS[kind];
  if (!parser) {
    return { kind: KINDS.UNKNOWN, map: null, teamARounds: null, teamBRounds: null, teamNames: [], players: [] };
  }
  return parser(ocr);
}

module.exports = {
  parseCapture, parseValorantPostMatch, parseValorantScoreboard, parseTrackerMatch,
  partirRiotId, buscarMapa, numero, encontrarCabecera, MAP_NAMES, AGENTS, COLUMNS
};
