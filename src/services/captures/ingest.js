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
const { findHeader } = require('./layout');
const { resolveTeamOrientation } = require('./reconcile');
const { inspectImage, UploadError } = require('./storage');

/** Confianza mínima del OCR por debajo de la cual se pide revisar sí o sí. */
const LOW_CONFIDENCE = 0.72;

/**
 * Cómo preparar la imagen, según de qué pantalla venga y de qué parte de ella.
 *
 * Las dos capturas reales son texto claro sobre fondo oscuro, y ahí lo que más
 * se nota es **invertir**: Tesseract está entrenado con tinta oscura sobre
 * papel claro. Después, un umbral limpia los degradados de fondo que en estas
 * interfaces son constantes.
 *
 * ⚠️ Y hace falta un perfil por BANDA, no sólo por pantalla. Medido sobre las
 * capturas de verdad: el umbral que deja la tabla legible quema el marcador de
 * la cabecera, y el que lee la cabecera deshace las filas. No son dos ajustes
 * del mismo problema: la cabecera es texto grande sobre arte de fondo y la
 * tabla es texto pequeño sobre bandas planas.
 */
const PERFILES = Object.freeze({
  [KINDS.TRACKER_MATCH]: {
    tabla: { upscale: 4, threshold: 160 },
    // Medido sobre la captura real: a 140 la fila de cabeceras da doce columnas
    // y a 160 sólo nueve. Se pierden +/-, K/D y DD justo por ahí.
    cabecera: { upscale: 3, threshold: 140 }
  },
  [KINDS.VALORANT_SCOREBOARD]: {
    tabla: { upscale: 4, threshold: 160 },
    // El marcador va en letra enorme sobre un degradado de fondo: hace falta un
    // umbral ALTO, que se queda con lo más claro y descarta el arte de detrás.
    // Medido: a 100 o sin umbral no aparece; a 180 sale «10 DERROTA 13».
    cabecera: { upscale: 3, threshold: 180 }
  },
  [KINDS.VALORANT_POST_MATCH]: {
    tabla: { upscale: 4, threshold: 160 },
    cabecera: { upscale: 3, threshold: 180 }
  },
  // Para clasificar basta con leer razonablemente; el perfil fino viene después.
  default: { tabla: { upscale: 2, threshold: null }, cabecera: null }
});

const MAX_ANCHO = 5000;

/**
 * Prepara la imagen. No sustituye al original: el archivo guardado sigue siendo
 * el que subieron, esto es sólo lo que ve el OCR.
 *
 * Devuelve también la escala aplicada, porque las cajas que salga el OCR están
 * en las coordenadas de ESTA imagen y hay que poder volver a las de la original.
 */
async function preprocess(buffer, { upscale = 2, threshold = null, crop = null } = {}) {
  const { width = 1280 } = await sharp(buffer).metadata();
  const destino = Math.min(MAX_ANCHO, Math.round(width * upscale));
  const escala = destino / width;

  /*
    Invertir sólo si el fondo es oscuro.

    Las dos pantallas de Valorant son texto claro sobre fondo oscuro, y ahí
    invertir es lo que más se nota: el motor está entrenado con tinta oscura
    sobre papel claro. Pero hacerlo SIEMPRE estropea cualquier captura de fondo
    claro, así que se decide mirando la imagen en vez de darlo por hecho.

    `flatten` antes de invertir: si no, negate() se lleva también el alfa y la
    imagen sale en blanco.
  */
  const base = sharp(buffer)
    .resize({ width: destino, kernel: 'lanczos3' })
    .flatten({ background: '#000000' })
    .grayscale();

  const { channels } = await base.clone().stats();
  const oscura = (channels[0]?.mean ?? 128) < 128;

  let imagen = oscura ? base.negate({ alpha: false }).normalise() : base.normalise();

  /*
    ⚠️ El recorte va DESPUÉS de normalizar, no antes.

    `normalise` estira el histograma de lo que se le da. Sobre una banda suelta,
    las estadísticas salen de esa banda y no de la captura: la franja del
    marcador se estira sola, pierde el contraste que tenía respecto al resto y
    se vuelve ilegible. Medido: recortando primero, «Bind 13 : 10» se leía como
    «CRT A A Cr Z».
  */
  if (crop) {
    const escalado = {
      left: Math.round(crop.left * escala),
      top: Math.round(crop.top * escala),
      width: Math.round(crop.width * escala),
      height: Math.round(crop.height * escala)
    };
    imagen = sharp(await imagen.png().toBuffer()).extract(escalado);
  }

  // El umbral está calibrado sobre las capturas invertidas; en una clara, que
  // ya sale con el texto oscuro, binarizar con ese valor se lo comería.
  imagen = (threshold === null || !oscura) ? imagen.sharpen() : imagen.threshold(threshold);

  return { buffer: await imagen.png().toBuffer(), scale: escala };
}

/**
 * Lee una imagen: OCR, tipo y datos.
 *
 * Tres pasadas, y cada una tiene su motivo:
 *
 *   1. genérica, sólo para saber de qué pantalla es;
 *   2. con el perfil de TABLA de esa pantalla, que es de donde salen las filas;
 *   3. con el de CABECERA, sobre la banda de arriba, de donde salen el mapa y
 *      el marcador.
 *
 * La tercera se recorta por encima de la fila de cabeceras que encontró la
 * segunda, así que no hay ninguna coordenada fija: si la captura viene a otra
 * resolución, el corte se mueve con ella.
 */
async function readCapture(buffer, { ocrProvider, key = null, preprocessing = true } = {}) {
  if (!preprocessing) {
    const crudo = normalizeResult(await ocrProvider.recognize(buffer, { key }));
    const tipoCrudo = classifyCapture(crudo);
    return {
      sourceKind: tipoCrudo.kind, classification: tipoCrudo, ocr: crudo,
      parsed: parseCapture(tipoCrudo.kind, crudo), profile: 'ninguno',
      confidence: (crudo.confidence || 0) / 100
    };
  }

  const generica = await preprocess(buffer, PERFILES.default.tabla);
  let ocr = normalizeResult(await ocrProvider.recognize(generica.buffer, { key }));
  let tipo = classifyCapture(ocr);

  const perfil = PERFILES[tipo.kind];
  if (!perfil) {
    return {
      sourceKind: tipo.kind, classification: tipo, ocr,
      parsed: parseCapture(tipo.kind, ocr), profile: 'default',
      confidence: (ocr.confidence || 0) / 100
    };
  }

  // --- 2. la tabla ---
  const tabla = await preprocess(buffer, perfil.tabla);
  const ocrTabla = normalizeResult(await ocrProvider.recognize(tabla.buffer, { key }));
  const tipoTabla = classifyCapture(ocrTabla);
  // Sólo se queda con ella si sigue reconociendo la misma pantalla.
  if (tipoTabla.kind === tipo.kind) { ocr = ocrTabla; tipo = tipoTabla; }

  let parsed = parseCapture(tipo.kind, ocr);

  // --- 3. la cabecera, si falta algo que vive ahí ---
  const faltaCabecera = !parsed.map
    || (parsed.teamARounds === null && !Array.isArray(parsed.scorePair));

  if (perfil.cabecera && faltaCabecera) {
    const banda = await bandaSuperior(buffer, ocr, tabla.scale);
    if (banda) {
      const recorte = await preprocess(buffer, { ...perfil.cabecera, crop: banda });
      const ocrCabecera = normalizeResult(await ocrProvider.recognize(recorte.buffer, { key }));
      const leidaCabecera = parseCapture(tipo.kind, ocrCabecera);

      // Si la banda ha reconocido MÁS columnas, se vuelve a leer la tabla con
      // ellas: son la misma fila de cabeceras, sólo que mejor leída.
      const enBanda = findHeader(ocrCabecera.lines || []);
      const enTabla = findHeader(ocr.lines || []);
      if (enBanda && enTabla && enBanda.columns.length > enTabla.columns.length) {
        const conMasColumnas = parseCapture(tipo.kind, ocr, {
          header: columnasEnEscala(enBanda, enTabla, recorte.scale, tabla.scale)
        });
        // Más columnas no sirve de nada si se pierden filas por el camino.
        if (conMasColumnas.players.length >= parsed.players.length) parsed = conMasColumnas;
      }

      // La banda de arriba manda en lo suyo, y sólo en lo suyo: nunca aporta
      // filas, porque sus renglones acaban en la cabecera de la tabla.
      parsed = {
        ...parsed,
        map: parsed.map ?? leidaCabecera.map,
        scorePair: parsed.scorePair ?? leidaCabecera.scorePair,
        teamARounds: parsed.teamARounds ?? leidaCabecera.teamARounds,
        teamBRounds: parsed.teamBRounds ?? leidaCabecera.teamBRounds,
        teamNames: parsed.teamNames?.length ? parsed.teamNames : leidaCabecera.teamNames
      };
    }
  }

  return {
    sourceKind: tipo.kind,
    classification: tipo,
    ocr,
    parsed,
    profile: tipo.kind,
    confidence: (ocr.confidence || 0) / 100
  };
}

/**
 * La franja que hay por encima de la fila de cabeceras, en coordenadas de la
 * imagen ORIGINAL.
 *
 * De ahí salen el mapa y el marcador en las dos interfaces.
 */
async function bandaSuperior(buffer, ocr, escala) {
  const cabecera = findHeader(ocr.lines || []);
  if (!cabecera) return null;

  const { width, height } = await sharp(buffer).metadata();
  if (!width || !height) return null;

  // Se incluye la propia fila de cabeceras: además del mapa y el marcador, de
  // ahí salen los nombres de las columnas, y con otro tratamiento se leen
  // columnas que en la pasada de la tabla se pierden.
  const corte = Math.round(cabecera.line.bbox.y1 / escala) + 4;
  const alto = Math.max(40, Math.min(corte, height));
  if (alto < 40 || alto >= height) return null;

  return { left: 0, top: 0, width, height: alto };
}

/**
 * Pasa las columnas leídas en la banda a las coordenadas de la pasada de tabla.
 *
 * Las dos son la misma imagen a distinta escala, así que basta una regla de
 * tres. No hay ninguna coordenada fija: si la captura viene a otra resolución,
 * las dos escalas cambian juntas.
 */
function columnasEnEscala(cabeceraBanda, cabeceraTabla, escalaBanda, escalaTabla) {
  const factor = escalaTabla / escalaBanda;
  const convertir = (sitio) => ({
    ...sitio,
    x0: sitio.x0 * factor, x1: sitio.x1 * factor, center: sitio.center * factor
  });
  /*
    ⚠️ Sólo viajan las COLUMNAS. El índice y la línea siguen siendo los de la
    pasada de tabla: son dos lecturas distintas, con listas de renglones
    distintas, y usar el índice de la banda haría que se recortara la tabla por
    donde no es.
  */
  /*
    Y se COMBINAN las columnas en vez de sustituirlas: las que la pasada de
    tabla ya reconoció se quedan como estaban —están medidas sobre los mismos
    píxeles que las filas— y de la banda sólo se traen las que faltaban.
    Sustituirlas todas movía los límites lo justo para perder filas enteras.
  */
  const yaEstan = new Set(cabeceraTabla.columns.map((columna) => columna.field));
  const nuevas = cabeceraBanda.columns
    .filter((columna) => !yaEstan.has(columna.field))
    .map(convertir);

  return {
    index: cabeceraTabla.index,
    line: cabeceraTabla.line,
    columns: [...cabeceraTabla.columns, ...nuevas]
      .sort((uno, otro) => uno.center - otro.center),
    boundaries: cabeceraTabla.boundaries ?? []
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
