'use strict';

/**
 * Cómo se concilia un mismo dato leído en dos fuentes distintas.
 *
 * Comparar «igual o distinto» no vale. Con capturas reales de la misma partida
 * el cliente de Valorant y Tracker dan ACS que difieren en 1 (357/357 pero
 * 352/353, 325/326, 212/213…): redondean distinto. Tratar eso como conflicto
 * mandaría a revisión todas las partidas del torneo y nadie volvería a mirar
 * los avisos.
 *
 * Pero la tolerancia NO puede ser global. Un K/D/A que difiere en 1 sí es un
 * problema de lectura, y un marcador que difiere en 1 cambia quién gana. Por eso
 * la política es explícita, por campo, y está probada.
 *
 * Y cuando las dos fuentes valen, se guarda cuál manda **y también lo que decía
 * la otra**: perder la observación original impide averiguar después por qué no
 * cuadraba algo.
 */

const SOURCES = Object.freeze({
  VALORANT: 'VALORANT',   // el cliente del juego: pantalla de puntuaciones
  TRACKER: 'TRACKER'      // tracker.gg
});

/** A qué fuente pertenece cada tipo de captura. */
const SOURCE_OF_KIND = Object.freeze({
  VALORANT_POST_MATCH: SOURCES.VALORANT,
  VALORANT_SCOREBOARD: SOURCES.VALORANT,
  TRACKER_MATCH: SOURCES.TRACKER
});

/**
 * La política, campo por campo.
 *
 * `tolerance` es la diferencia máxima que se acepta sin considerarlo conflicto.
 * `canonical` es la fuente que manda cuando las dos traen el dato; se elige por
 * cercanía al origen, no por comodidad: lo que enseña el cliente del juego es el
 * dato de primera mano y Tracker lo deriva.
 */
const FIELD_POLICY = Object.freeze({
  // --- del partido ---
  map: { tolerance: 0, canonical: SOURCES.TRACKER },
  teamARounds: { tolerance: 0, canonical: SOURCES.TRACKER },
  teamBRounds: { tolerance: 0, canonical: SOURCES.TRACKER },

  // --- del jugador, en las dos fuentes ---
  // Redondean distinto: una diferencia de 1 es normal y no bloquea.
  acs: { tolerance: 1, canonical: SOURCES.VALORANT, varianceCode: 'ROUNDING_VARIANCE' },
  // Estas son cuentas enteras: si no cuadran, alguien ha leído mal.
  kills: { tolerance: 0, canonical: SOURCES.VALORANT },
  deaths: { tolerance: 0, canonical: SOURCES.VALORANT },
  assists: { tolerance: 0, canonical: SOURCES.VALORANT },
  firstKills: { tolerance: 0, canonical: SOURCES.VALORANT },
  agent: { tolerance: 0, canonical: SOURCES.VALORANT },

  // --- sólo Tracker las enseña ---
  adr: { tolerance: 0.1, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  hsPercent: { tolerance: 0, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  kastPercent: { tolerance: 0, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  plusMinus: { tolerance: 0, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  kdRatio: { tolerance: 0.1, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  ddDelta: { tolerance: 1, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  firstDeaths: { tolerance: 0, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },
  multiKills: { tolerance: 0, canonical: SOURCES.TRACKER, only: [SOURCES.TRACKER] },

  // --- sólo el cliente las enseña ---
  economyRating: { tolerance: 0, canonical: SOURCES.VALORANT, only: [SOURCES.VALORANT] },
  spikesPlanted: { tolerance: 0, canonical: SOURCES.VALORANT, only: [SOURCES.VALORANT] },
  defuses: { tolerance: 0, canonical: SOURCES.VALORANT, only: [SOURCES.VALORANT] }
});

/** Política por defecto para un campo que aún no esté en la tabla. */
const DEFAULT_POLICY = Object.freeze({ tolerance: 0, canonical: null });

const policyFor = (field) => FIELD_POLICY[field] ?? DEFAULT_POLICY;

const presente = (valor) => valor !== null && valor !== undefined && valor !== '';

/**
 * Concilia las observaciones de un campo.
 *
 * Una observación puede venir marcada como NO FIABLE por quien la leyó: el OCR
 * sabe cuándo no ha podido separar bien una celda. Eso no es lo mismo que un
 * valor distinto, y no puede tratarse igual.
 *
 * @param {string} field
 * @param {Array<{source: string, captureId: number, value: *, reliable?: boolean}>} observaciones
 */
function reconcileField(field, observaciones) {
  const politica = policyFor(field);
  const conDato = (observaciones || []).filter((obs) => presente(obs.value));

  if (conDato.length === 0) {
    // Nadie lo vio. Null, no cero: faltar no es valer cero.
    return {
      value: null, observations: [], conflict: null, variance: null,
      uncertain: null, canonicalSource: null
    };
  }

  // Si el campo sólo lo enseña una fuente, lo que diga otra no se compara: no
  // son la misma medida aunque se llamen igual.
  const competentes = politica.only
    ? conDato.filter((obs) => politica.only.includes(obs.source))
    : conDato;
  if (competentes.length === 0) {
    return {
      value: null, observations: conDato, conflict: null, variance: null,
      uncertain: null, canonicalSource: null
    };
  }

  // Todas se conservan, fiables o no: sin ellas no se puede averiguar después
  // por qué un número no cuadraba.
  const todas = competentes.map((obs) => ({
    source: obs.source, captureId: obs.captureId, value: obs.value,
    ...(obs.reliable === false ? { reliable: false } : {})
  }));

  const fiables = competentes.filter((obs) => obs.reliable !== false);

  /*
    ⚠️ Una lectura marcada como dudosa NO se compara de igual a igual con una
    limpia. Si se hiciera, un «73» que en realidad era «3» saldría como
    discrepancia entre fuentes, y no lo es: es una fuente que ha reconocido no
    haber sabido leerlo.

    Pero tampoco se corrige el 73 hasta el 3, que sería inventar. Simplemente se
    usa la que sí se leyó bien, y se anota de dónde ha salido.
  */
  if (fiables.length > 0 && fiables.length < competentes.length) {
    const elegido = elegirCanonico(fiables, politica);
    const desacuerdo = comprobarDesacuerdo(field, fiables, politica);
    return {
      value: elegido.value,
      canonicalSource: elegido.source,
      observations: todas,
      conflict: desacuerdo.conflict,
      variance: desacuerdo.variance,
      // No es un problema: es una fuente cubriendo el hueco de la otra.
      fallback: {
        field, code: 'OCR_SOURCE_FALLBACK', usedSource: elegido.source,
        discarded: competentes
          .filter((obs) => obs.reliable === false)
          .map((obs) => ({ source: obs.source, value: obs.value }))
      },
      uncertain: null
    };
  }

  // Si NINGUNA es fiable, no hay de dónde sacar el dato. Se enseña lo leído
  // para que se pueda corregir, pero marcado: nunca se da por bueno solo.
  if (fiables.length === 0) {
    const elegido = elegirCanonico(competentes, politica);
    return {
      value: elegido.value,
      canonicalSource: elegido.source,
      observations: todas,
      conflict: null,
      variance: null,
      uncertain: { field, code: 'FIELD_UNCERTAIN', sources: competentes.map((obs) => obs.source) }
    };
  }

  const elegido = elegirCanonico(fiables, politica);
  const desacuerdo = comprobarDesacuerdo(field, fiables, politica);

  return {
    value: elegido.value,
    canonicalSource: elegido.source,
    observations: todas,
    conflict: desacuerdo.conflict,
    variance: desacuerdo.variance,
    uncertain: null
  };
}

/** La fuente que manda, o la primera si la política no expresa preferencia. */
function elegirCanonico(observaciones, politica) {
  if (politica.canonical) {
    const preferida = observaciones.find((obs) => obs.source === politica.canonical);
    if (preferida) return preferida;
  }
  return observaciones[0];
}

function comprobarDesacuerdo(field, observaciones, politica) {
  const valores = observaciones.map((obs) => obs.value);
  const distintos = [...new Set(valores.map((valor) => JSON.stringify(valor)))];
  if (distintos.length === 1) return { conflict: null, variance: null };

  const numericos = valores.every((valor) => typeof valor === 'number' && Number.isFinite(valor));
  if (numericos && politica.tolerance > 0) {
    const diferencia = Math.max(...valores) - Math.min(...valores);
    // Dentro de tolerancia: se anota como discrepancia conocida, no bloquea.
    if (diferencia <= politica.tolerance + 1e-9) {
      return {
        conflict: null,
        variance: {
          field,
          code: politica.varianceCode ?? 'SOURCE_VARIANCE',
          difference: Number(diferencia.toFixed(4)),
          values: observaciones.map((obs) => ({ source: obs.source, value: obs.value }))
        }
      };
    }
  }

  return {
    conflict: {
      field,
      values: distintos.map((texto) => JSON.parse(texto)),
      sources: observaciones.map((obs) => obs.source),
      captureIds: observaciones.map((obs) => obs.captureId)
    },
    variance: null
  };
}

// ------------------------------------------------------------------ marcador

/**
 * Compara dos marcadores sabiendo que uno puede venir sin orientar.
 *
 * La pantalla del cliente dice «10 DERROTA 13» desde el punto de vista de quien
 * jugó, así que por sí sola no dice qué equipo del torneo hizo 13. Tracker sí
 * separa Team A y Team B, y es quien orienta.
 *
 * Por eso un 13-10 de Tracker y un 10-13 del cliente son **compatibles**: el
 * conjunto de rondas es el mismo. Tratarlo como conflicto sería un falso aviso
 * en todas las partidas.
 */
function reconcileScore({ oriented, unordered }) {
  if (!oriented && !unordered) {
    return { ok: false, code: 'SCORE_NOT_DETECTED', teamARounds: null, teamBRounds: null };
  }

  // Sin Tracker no se sabe a qué equipo va cada cifra.
  if (!oriented) {
    return {
      ok: false, code: 'SCORE_NOT_ORIENTED',
      teamARounds: null, teamBRounds: null, pair: [...unordered].sort((a, b) => a - b)
    };
  }

  const orientado = { teamARounds: oriented[0], teamBRounds: oriented[1] };
  if (!unordered) return { ok: true, ...orientado, corroborated: false };

  const mismoPar = [...oriented].sort((a, b) => a - b).join('-')
    === [...unordered].sort((a, b) => a - b).join('-');

  if (!mismoPar) {
    return {
      ok: false, code: 'SCORE_CONFLICT', ...orientado,
      values: [oriented, unordered]
    };
  }
  return { ok: true, ...orientado, corroborated: true };
}

// ------------------------------------------------ orientación de los equipos

/**
 * Averigua qué equipo del torneo es el «Team A» de la captura.
 *
 * ⚠️ Que Tracker llame Team A a un lado no significa nada: puede ser cualquiera
 * de los dos equipos de la serie. Asignar el 13 a `series.teamA` por la posición
 * en la imagen es exactamente cómo se registra un resultado invertido.
 *
 * Se resuelve mirando a QUIÉN ha reconocido en cada lado.
 *
 * @param {Array<{visualTeam: 'A'|'B', participantId: number|null}>} jugadores
 * @param {{teamAId: number, teamBId: number}} serie
 * @param {Map<number, number>} equipoDe  participantId -> teamId real
 */
function resolveTeamOrientation(jugadores, serie, equipoDe) {
  const cuenta = { A: new Map(), B: new Map() };

  for (const jugador of jugadores) {
    const lado = jugador.visualTeam;
    const equipo = jugador.participantId ? equipoDe.get(jugador.participantId) : null;
    if (!lado || !equipo) continue;
    cuenta[lado].set(equipo, (cuenta[lado].get(equipo) ?? 0) + 1);
  }

  const dominante = (lado) => {
    const filas = [...cuenta[lado].entries()].sort((uno, otro) => otro[1] - uno[1]);
    if (filas.length === 0) return null;
    // Si en un lado hay gente de los dos equipos, ese lado no identifica nada.
    if (filas.length > 1 && filas[0][1] === filas[1][1]) return null;
    return { teamId: filas[0][0], count: filas[0][1], mixed: filas.length > 1 };
  };

  const ladoA = dominante('A');
  const ladoB = dominante('B');

  if (!ladoA || !ladoB) {
    return { ok: false, code: 'ORIENTATION_UNKNOWN', teamAId: null, teamBId: null };
  }
  if (ladoA.teamId === ladoB.teamId) {
    return { ok: false, code: 'ORIENTATION_AMBIGUOUS', teamAId: null, teamBId: null };
  }
  if (ladoA.mixed || ladoB.mixed) {
    // Un lado con jugadores de los dos equipos: el reparto no cuadra y hay que
    // mirarlo antes de asignar un marcador.
    return { ok: false, code: 'ORIENTATION_MIXED', teamAId: null, teamBId: null };
  }
  if (![serie.teamAId, serie.teamBId].includes(ladoA.teamId)
    || ![serie.teamAId, serie.teamBId].includes(ladoB.teamId)) {
    return { ok: false, code: 'ORIENTATION_FOREIGN', teamAId: null, teamBId: null };
  }

  return {
    ok: true,
    teamAId: ladoA.teamId,     // a quién corresponde el «Team A» de la captura
    teamBId: ladoB.teamId,
    // Se puede resolver con alguna fila perdida, mientras el lado sea inequívoco.
    confidence: Math.min(1, (ladoA.count + ladoB.count) / 10),
    // Si la captura está al revés que la serie, hay que dar la vuelta al marcador.
    swapped: ladoA.teamId !== serie.teamAId
  };
}

module.exports = {
  reconcileField, reconcileScore, resolveTeamOrientation,
  policyFor, SOURCES, SOURCE_OF_KIND, FIELD_POLICY
};
