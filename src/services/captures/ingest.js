'use strict';

/**
 * La cadena entera de una captura:
 *
 *   subir -> validar -> preprocesar -> OCR -> clasificar -> parsear
 *         -> fusionar -> asociar jugadores -> previsualizar -> confirmar
 *
 * Nada de esto toca el resultado oficial. Hasta que alguien confirma, un lote
 * es una propuesta: si el OCR se equivoca, se corrige en pantalla o se descarta
 * y no ha pasado nada.
 */

const sharp = require('sharp');
const { normalizeResult } = require('../ocr');
const { classifyCapture, KINDS } = require('./classify');
const { parseCapture } = require('./parsers');
const { mergeCaptures } = require('./merge');
const { matchRoster, MATCH } = require('./match-players');
const { inspectImage, UploadError } = require('./storage');

/** Confianza mínima del OCR por debajo de la cual se pide revisar sí o sí. */
const LOW_CONFIDENCE = 0.72;

/**
 * Prepara la imagen para leerla mejor. No sustituye al original: el archivo
 * guardado sigue siendo el que subieron, esto es sólo lo que ve el OCR.
 *
 * Las capturas de Valorant son claras sobre fondo oscuro y con texto pequeño;
 * agrandar y subir el contraste es lo que más se nota.
 */
async function preprocess(buffer, { upscale = 1.6, maxWidth = 3200 } = {}) {
  const imagen = sharp(buffer);
  const { width } = await imagen.metadata();
  const destino = Math.min(maxWidth, Math.round((width || 1280) * upscale));

  return sharp(buffer)
    .resize({ width: destino, withoutEnlargement: false })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
}

/**
 * Lee una imagen: OCR, tipo y datos. Devuelve todo lo que hace falta guardar.
 */
async function readCapture(buffer, { ocrProvider, key = null, preprocessing = true } = {}) {
  const paraLeer = preprocessing ? await preprocess(buffer) : buffer;
  const bruto = await ocrProvider.recognize(paraLeer, { key });
  const ocr = normalizeResult(bruto);
  const tipo = classifyCapture(ocr);
  const parsed = parseCapture(tipo.kind, ocr);

  return {
    sourceKind: tipo.kind,
    classification: tipo,
    ocr,
    parsed,
    // La confianza del motor va de 0 a 100; aquí todo va de 0 a 1.
    confidence: (ocr.confidence || 0) / 100
  };
}

/**
 * Junta las lecturas de un lote y decide si se puede confirmar tal cual o hay
 * que mirarlo. Es la única función que decide eso: la interfaz sólo lo pinta.
 *
 * @param {Array} lecturas       lo que devolvió readCapture, con su captureId
 * @param {object} contexto      { roster, expectedMap, teamAId, teamBId, scorePolicy }
 */
function buildPreview(lecturas, contexto) {
  const { roster = [], expectedMap = null, teamAId = null, teamBId = null } = contexto;

  const fusion = mergeCaptures(lecturas.map((lectura) => ({
    captureId: lectura.captureId,
    kind: lectura.sourceKind,
    parsed: lectura.parsed
  })));

  const problemas = [];
  const aviso = (code, message, extra = {}) => problemas.push({ code, message, ...extra });

  for (const conflicto of fusion.conflicts) {
    aviso('CONFLICT', `Las capturas no coinciden en ${conflicto.field}.`, {
      field: conflicto.field, values: conflicto.values
    });
  }

  const desconocidas = lecturas.filter((lectura) => lectura.sourceKind === KINDS.UNKNOWN);
  if (desconocidas.length) {
    aviso('UNKNOWN_CAPTURE',
      `No se ha reconocido ${desconocidas.length === 1 ? 'una captura' : `${desconocidas.length} capturas`}.`);
  }

  const flojas = lecturas.filter((lectura) => lectura.confidence < LOW_CONFIDENCE);
  if (flojas.length) {
    aviso('LOW_CONFIDENCE', 'El texto se ha leído con poca claridad: revisa los números.');
  }

  // --- mapa ---
  if (!fusion.map) {
    aviso('MAP_NOT_DETECTED', 'No se ha reconocido el mapa en las capturas.');
  } else if (expectedMap && fusion.map !== expectedMap) {
    // Que la captura diga Haven y el partido esperara Ascent puede ser un OCR
    // torpe o la captura de otro partido. No se importa por las buenas.
    aviso('MAP_MISMATCH',
      `El mapa de la captura (${fusion.map}) no coincide con el asignado (${expectedMap}).`,
      { detected: fusion.map, expected: expectedMap });
  }

  // --- marcador ---
  if (fusion.teamARounds === null || fusion.teamBRounds === null) {
    aviso('SCORE_NOT_DETECTED', 'No se ha reconocido el marcador.');
  }

  // --- jugadores ---
  const asociados = matchRoster(fusion.players, roster);
  const equipos = new Set([teamAId, teamBId].filter(Boolean));
  const usados = new Map();

  for (const jugador of asociados) {
    if (jugador.match === MATCH.AMBIGUOUS) {
      aviso('PLAYER_AMBIGUOUS', `Hay varios jugadores parecidos a "${jugador.raw}".`,
        { raw: jugador.raw });
    } else if (jugador.match === MATCH.NONE) {
      aviso('PLAYER_UNKNOWN', `No se ha reconocido a "${jugador.raw}" entre los dos equipos.`,
        { raw: jugador.raw });
    } else if (jugador.match === MATCH.FUZZY) {
      aviso('PLAYER_SUGGESTED', `"${jugador.raw}" se parece a un jugador, pero conviene comprobarlo.`,
        { raw: jugador.raw, participantId: jugador.participantId });
    }

    if (jugador.participantId) {
      if (usados.has(jugador.participantId)) {
        aviso('PLAYER_DUPLICATED',
          `El mismo jugador aparece dos veces: "${jugador.raw}".`, { raw: jugador.raw });
      }
      usados.set(jugador.participantId, true);

      if (equipos.size && jugador.teamId && !equipos.has(jugador.teamId)) {
        aviso('PLAYER_NOT_IN_SERIES',
          `"${jugador.raw}" no juega en ninguno de los dos equipos.`, { raw: jugador.raw });
      }
    }
  }

  const esperados = roster.length;
  if (esperados && asociados.length && asociados.length !== esperados) {
    aviso('ROSTER_INCOMPLETE',
      `Se han leído ${asociados.length} jugadores y el partido tiene ${esperados}.`);
  }

  // Basta un problema para pedir revisión. Es a propósito: la previsualización
  // es barata y un resultado equivocado en la clasificación no lo es.
  const bloquea = problemas.some((problema) => problema.code !== 'PLAYER_SUGGESTED');
  const dudas = problemas.length > 0;

  return {
    map: fusion.map,
    teamARounds: fusion.teamARounds,
    teamBRounds: fusion.teamBRounds,
    players: asociados,
    issues: problemas,
    status: bloquea ? 'REVIEW_REQUIRED' : 'READY',
    confidence: Math.min(
      ...lecturas.map((lectura) => lectura.confidence),
      dudas ? 0.7 : 1
    ),
    captureCount: fusion.captureCount
  };
}

module.exports = {
  preprocess, readCapture, buildPreview, inspectImage, UploadError, LOW_CONFIDENCE
};
