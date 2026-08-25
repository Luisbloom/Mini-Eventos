'use strict';

/**
 * Las cabeceras que sabemos leer, en las dos interfaces y en los dos idiomas.
 *
 * El cliente de Valorant está en el idioma de quien juega, así que la pantalla
 * real de este torneo llega en español: «PUNT. MED. COMBATE», «PRIMERAS
 * SANGRES», «DESACTIVACIONES». Y el OCR se come acentos y puntos con facilidad,
 * de modo que la comparación se hace sobre texto normalizado y no sobre la
 * cadena exacta.
 */

/** Sin acentos, sin puntos, en mayúsculas y con los espacios colapsados. */
function normalizeHeader(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // fuera los acentos que el OCR pierde
    .replace(/[Δ∆]/g, '')     // la delta de DDΔ: el OCR no la saca casi nunca
    .replace(/[.:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Alias -> campo. Las claves ya están normalizadas.
 *
 * `kda` no es un campo: es una celda agrupada («28 / 9 / 7») que se reparte
 * después en kills, deaths y assists.
 */
const COLUMN_ALIASES = Object.freeze({
  // --- puntuación de combate ---
  ACS: 'acs',
  SCORE: 'acs',
  'COMBAT SCORE': 'acs',
  'AVG COMBAT SCORE': 'acs',
  'PUNT MED COMBATE': 'acs',
  'PUNT MED DE COMBATE': 'acs',
  'PUNTUACION MEDIA DE COMBATE': 'acs',
  'PUNTUACION MEDIA COMBATE': 'acs',

  // --- bajas, muertes, asistencias ---
  K: 'kills', KILLS: 'kills', BAJAS: 'kills',
  D: 'deaths', DEATHS: 'deaths', MUERTES: 'deaths',
  A: 'assists', ASSISTS: 'assists', ASISTENCIAS: 'assists',
  // El cliente las junta en una sola columna. Ojo: aqui NO puede haber un alias
  // de tres palabras sueltas ("K D A"), porque se comeria las tres columnas
  // independientes de cualquier tabla que las liste por separado.
  AMA: 'kda',
  KDA: 'kda',
  'K/D/A': 'kda',

  // --- Tracker ---
  '+/-': 'plusMinus',
  'K/D': 'kdRatio',
  KD: 'kdRatio',
  DD: 'ddDelta',
  'DD DELTA': 'ddDelta',
  DDA: 'ddDelta',                        // el OCR suele perder la Δ
  ADR: 'adr', DDR: 'adr',
  'HS%': 'hsPercent', HS: 'hsPercent',
  'KAST%': 'kastPercent', KAST: 'kastPercent',
  FK: 'firstKills', FB: 'firstKills',
  FD: 'firstDeaths',
  MK: 'multiKills',

  // --- del cliente ---
  ECONOMIA: 'economyRating',
  ECONOMY: 'economyRating',
  'PRIMERAS SANGRES': 'firstKills',
  'FIRST BLOODS': 'firstKills',
  'SPIKES COLOCADAS': 'spikesPlanted',
  'SPIKES PLANTED': 'spikesPlanted',
  PLANTS: 'spikesPlanted',
  DESACTIVACIONES: 'defuses',
  DEFUSES: 'defuses'
});

/**
 * Cabeceras conocidas que no traen número. Hay dos clases y la diferencia
 * importa, porque de ellas sale dónde acaba el nombre del jugador:
 *
 * - Las que ETIQUETAN la propia columna del nombre. Están en el borde izquierdo,
 *   encima de los nombres, así que no separan nada.
 * - Las que ocupan una columna PROPIA entre el nombre y los datos, como el rango
 *   de Tracker. Ésas sí marcan el final del nombre: sin tenerlas en cuenta, el
 *   «Silver» del rango acaba pegado al Riot ID.
 */
const NAME_HEADERS = Object.freeze(new Set([
  'PLAYER', 'JUGADOR', 'AGENT', 'AGENTE',
  'ORDENADO DE FORMA INDIVIDUAL', 'ORDENADO INDIVIDUALMENTE'
]));

const SPACER_HEADERS = Object.freeze(new Set([
  'CURRENT RANK', 'RANK', 'RANGO', 'RANGO ACTUAL'
]));

const IGNORED_HEADERS = Object.freeze(new Set([...NAME_HEADERS, ...SPACER_HEADERS]));

/** Cuántas palabras seguidas puede ocupar una cabecera («PUNT MED COMBATE»). */
const MAX_HEADER_WORDS = 4;

/** Campos que son porcentajes: fuera de 0..100 es un error de lectura. */
const PERCENT_FIELDS = Object.freeze(new Set(['hsPercent', 'kastPercent']));

/** Campos con decimales de verdad; el resto se redondea a entero. */
const DECIMAL_FIELDS = Object.freeze(new Set(['adr', 'kdRatio']));

function fieldForHeader(texto) {
  const clave = normalizeHeader(texto);
  if (IGNORED_HEADERS.has(clave)) return null;
  return COLUMN_ALIASES[clave] ?? null;
}

/** Si es una cabecera que sabemos reconocer, traiga datos o no. */
function isKnownHeader(texto) {
  const clave = normalizeHeader(texto);
  return IGNORED_HEADERS.has(clave) || Boolean(COLUMN_ALIASES[clave]);
}

/** Si ocupa una columna propia entre el nombre y los datos. */
function isSpacerHeader(texto) {
  return SPACER_HEADERS.has(normalizeHeader(texto));
}

module.exports = {
  normalizeHeader, fieldForHeader, isKnownHeader, isSpacerHeader,
  COLUMN_ALIASES, IGNORED_HEADERS, NAME_HEADERS, SPACER_HEADERS,
  MAX_HEADER_WORDS, PERCENT_FIELDS, DECIMAL_FIELDS
};
