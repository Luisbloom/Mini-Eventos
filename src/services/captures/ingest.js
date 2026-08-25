'use strict';

/**
 * La cadena entera de una captura:
 *
 *   subir -> validar -> preprocesar -> OCR -> clasificar -> parsear
 *         -> fusionar -> orientar equipos -> asociar jugadores
 *         -> previsualizar -> confirmar
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
const { resolveTeamOrientation } = require('./reconcile');
const { inspectImage, UploadError } = require('./storage');

/** Confianza mínima del OCR por debajo de la cual se pide revisar sí o sí. */
const LOW_CONFIDENCE = 0.72;

/**
 * Cómo preparar la imagen para leerla mejor, según de qué pantalla venga.
 *
 * No sirve el mismo tratamiento para las dos: la de Tracker tiene texto pequeño
 * y muchas columnas, con las etiquetas del Riot ID en gris claro y diminutas, y
 * un umbral agresivo se las come. La del cliente tiene texto grande sobre
 * fondos de color, y aguanta más contraste.
 */
const PERFILES = Object.freeze({
  [KINDS.TRACKER_MATCH]: { upscale: 2.0, maxWidth: 4000, sharpen: true, normalise: true },
  [KINDS.VALORANT_SCOREBOARD]: { upscale: 1.6, maxWidth: 3200, sharpen: true, normalise: true },
  [KINDS.VALORANT_POST_MATCH]: { upscale: 1.6, maxWidth: 3200, sharpen: true, normalise: true },
  default: { upscale: 1.8, maxWidth: 3600, sharpen: true, normalise: true }
});

/**
 * Prepara la imagen. No sustituye al original: el archivo guardado sigue siendo
 * el que subieron, esto es sólo lo que ve el OCR.
 */
async function preprocess(buffer, opciones = {}) {
  const perfil = { ...PERFILES.default, ...opciones };
  const { width } = await sharp(buffer).metadata();
  const destino = Math.min(perfil.maxWidth, Math.round((width || 1280) * perfil.upscale));

  let imagen = sharp(buffer)
    .resize({ width: destino, withoutEnlargement: false })
    .grayscale();

  // Nada de umbral fijo: convertir a blanco y negro puro borra el texto gris de
  // las etiquetas, que es justo lo que hace falta para el Riot ID.
  if (perfil.normalise) imagen = imagen.normalise();
  if (perfil.sharpen) imagen = imagen.sharpen();

  return imagen.png().toBuffer();
}

/**
 * Lee una imagen: OCR, tipo y datos.
 *
 * Se lee dos veces cuando hace falta: la primera para saber de qué pantalla es,
 * y la segunda con el tratamiento que le corresponde. Sale más barato que
 * acertar poco con un tratamiento genérico.
 */
async function readCapture(buffer, { ocrProvider, key = null, preprocessing = true } = {}) {
  const primera = preprocessing ? await preprocess(buffer) : buffer;
  let ocr = normalizeResult(await ocrProvider.recognize(primera, { key }));
  let tipo = classifyCapture(ocr);

  const perfil = PERFILES[tipo.kind];
  if (preprocessing && perfil && perfil !== PERFILES.default) {
    const afinada = await preprocess(buffer, perfil);
    const segunda = normalizeResult(await ocrProvider.recognize(afinada, { key }));
    const tipoSegunda = classifyCapture(segunda);
    // Sólo se queda con la segunda si no empeora el reconocimiento.
    if (tipoSegunda.kind === tipo.kind && segunda.words.length >= ocr.words.length * 0.95) {
      ocr = segunda;
      tipo = tipoSegunda;
    }
  }

  return {
    sourceKind: tipo.kind,
    classification: tipo,
    ocr,
    parsed: parseCapture(tipo.kind, ocr),
    profile: perfil ? tipo.kind : 'default',
    // La confianza del motor va de 0 a 100; aquí todo va de 0 a 1.
    confidence: (ocr.confidence || 0) / 100
  };
}

/**
 * Junta las lecturas de un lote y decide si se puede confirmar tal cual o hay
 * que mirarlo. Es la única función que decide eso: la interfaz sólo lo pinta.
 */
function buildPreview(lecturas, contexto) {
  const {
    roster = [], expectedMap = null, teamAId = null, teamBId = null,
    teamAName = null, teamBName = null
  } = contexto;

  const fusion = mergeCaptures(lecturas.map((lectura) => ({
    captureId: lectura.captureId,
    kind: lectura.sourceKind,
    parsed: lectura.parsed
  })));

  const problemas = [];
  const notas = [];
  const aviso = (code, message, extra = {}) => problemas.push({ code, message, ...extra });

  for (const conflicto of fusion.conflicts) {
    aviso('CONFLICT',
      `Las capturas no coinciden en ${conflicto.player ? `${conflicto.player}: ` : ''}${conflicto.field}.`,
      { field: conflicto.field, values: conflicto.values, player: conflicto.player ?? null });
  }

  // Las discrepancias conocidas se anotan pero no bloquean: el cliente y Tracker
  // redondean el ACS distinto y siempre difieren en 1.
  for (const variacion of fusion.variances) {
    notas.push({
      code: variacion.code, field: variacion.field, player: variacion.player ?? null,
      values: variacion.values, difference: variacion.difference
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
    aviso('MAP_MISMATCH',
      `El mapa de la captura (${fusion.map}) no coincide con el asignado (${expectedMap}).`,
      { detected: fusion.map, expected: expectedMap });
  }

  // --- jugadores ---
  const asociados = matchRoster(fusion.players, roster);
  const equipoDe = new Map(roster.map((persona) => [persona.participantId, persona.teamId]));
  const equipos = new Set([teamAId, teamBId].filter(Boolean));
  const usados = new Set();

  for (const jugador of asociados) {
    if (jugador.match === MATCH.AMBIGUOUS) {
      aviso('PLAYER_AMBIGUOUS', `Hay varios jugadores parecidos a "${jugador.raw}".`, { raw: jugador.raw });
    } else if (jugador.match === MATCH.NONE) {
      aviso('PLAYER_UNKNOWN', `No se ha reconocido a "${jugador.raw}" entre los dos equipos.`, { raw: jugador.raw });
    } else if (jugador.match === MATCH.FUZZY) {
      aviso('PLAYER_SUGGESTED', `"${jugador.raw}" se parece a un jugador, pero conviene comprobarlo.`,
        { raw: jugador.raw, participantId: jugador.participantId });
    }

    if (jugador.participantId) {
      if (usados.has(jugador.participantId)) {
        aviso('PLAYER_DUPLICATED', `El mismo jugador aparece dos veces: "${jugador.raw}".`, { raw: jugador.raw });
      }
      usados.add(jugador.participantId);
      if (equipos.size && jugador.teamId && !equipos.has(jugador.teamId)) {
        aviso('PLAYER_NOT_IN_SERIES', `"${jugador.raw}" no juega en ninguno de los dos equipos.`, { raw: jugador.raw });
      }
    }
  }

  const esperados = roster.length;
  if (esperados && asociados.length && asociados.length !== esperados) {
    aviso('ROSTER_INCOMPLETE',
      `Se han leído ${asociados.length} jugadores y el partido tiene ${esperados}.`);
  }

  // --- a qué equipo va cada cifra del marcador ---
  const marcador = orientarMarcador({
    fusion, asociados, equipoDe, teamAId, teamBId, teamAName, teamBName, aviso
  });

  // Basta un problema para pedir revisión. Es a propósito: la previsualización
  // es barata y un resultado equivocado en la clasificación no lo es.
  const bloquea = problemas.some((problema) => problema.code !== 'PLAYER_SUGGESTED');

  return {
    map: fusion.map,
    teamARounds: marcador.teamARounds,
    teamBRounds: marcador.teamBRounds,
    orientation: marcador.orientation,
    players: asociados,
    issues: problemas,
    // Diferencias conocidas entre fuentes: informativas, no bloquean.
    notes: notas,
    status: bloquea ? 'REVIEW_REQUIRED' : 'READY',
    confidence: Math.min(
      ...lecturas.map((lectura) => lectura.confidence),
      problemas.length ? 0.7 : 1
    ),
    captureCount: fusion.captureCount
  };
}

/**
 * Pasa el marcador de «como salía en la captura» a «de este equipo del torneo».
 *
 * ⚠️ Que Tracker llame Team A a un lado no dice nada: puede ser cualquiera de
 * los dos equipos de la serie. Asignar el 13 a `series.teamA` por la posición en
 * la imagen es exactamente cómo se registra un resultado invertido.
 */
function orientarMarcador({ fusion, asociados, equipoDe, teamAId, teamBId, teamAName, teamBName, aviso }) {
  const sinOrientar = { teamARounds: null, teamBRounds: null, orientation: null };

  if (fusion.teamARounds === null || fusion.teamBRounds === null) {
    const codigo = fusion.score?.code;
    if (codigo === 'SCORE_NOT_ORIENTED') {
      aviso('SCORE_NOT_ORIENTED',
        'Esta captura no dice a qué equipo corresponde cada marcador. Hace falta una de Tracker.');
    } else if (codigo !== 'SCORE_CONFLICT') {
      aviso('SCORE_NOT_DETECTED', 'No se ha reconocido el marcador.');
    }
    return sinOrientar;
  }

  if (!teamAId || !teamBId) return { ...fusion, orientation: null };

  // Primero por quién sale en cada lado: es lo más fiable, porque los nombres
  // de equipo no siempre aparecen y los jugadores sí.
  let orientacion = resolveTeamOrientation(asociados, { teamAId, teamBId }, equipoDe);

  // Si la captura no separaba lados, puede que traiga los nombres junto al
  // marcador, como hace la pantalla de fin de partida.
  if (!orientacion.ok) {
    orientacion = orientarPorNombre(fusion.teamNames, { teamAId, teamBId, teamAName, teamBName })
      ?? orientacion;
  }

  if (!orientacion.ok) {
    aviso(orientacion.code,
      'No se puede saber con seguridad qué equipo hizo cada marcador: revísalo antes de importar.');
    return sinOrientar;
  }

  // Si la captura tenía los equipos al revés que la serie, se da la vuelta.
  return {
    teamARounds: orientacion.swapped ? fusion.teamBRounds : fusion.teamARounds,
    teamBRounds: orientacion.swapped ? fusion.teamARounds : fusion.teamBRounds,
    orientation: {
      swapped: orientacion.swapped,
      confidence: orientacion.confidence,
      captureTeamA: orientacion.teamAId,
      captureTeamB: orientacion.teamBId
    }
  };
}

/** Sin acentos ni signos, para comparar nombres de equipo escritos a mano. */
const clave = (texto) => String(texto || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();

/**
 * Orienta usando los nombres que la captura enseña junto al marcador.
 *
 * Sólo vale si los dos se reconocen y son distintos: con uno solo no se sabe si
 * el otro número es del rival o de un tercero mal leído.
 */
function orientarPorNombre(nombresLeidos, { teamAId, teamBId, teamAName, teamBName }) {
  if (!teamAName || !teamBName) return null;
  const leidos = (nombresLeidos || []).map(clave).filter(Boolean);
  if (leidos.length < 2) return null;

  const equipoDeNombre = new Map([[clave(teamAName), teamAId], [clave(teamBName), teamBId]]);
  const primero = equipoDeNombre.get(leidos[0]);
  const segundo = equipoDeNombre.get(leidos[1]);
  if (!primero || !segundo || primero === segundo) return null;

  return {
    ok: true, teamAId: primero, teamBId: segundo,
    confidence: 0.9, swapped: primero !== teamAId
  };
}

module.exports = {
  preprocess, readCapture, buildPreview, orientarPorNombre, inspectImage, UploadError,
  LOW_CONFIDENCE, PERFILES
};
