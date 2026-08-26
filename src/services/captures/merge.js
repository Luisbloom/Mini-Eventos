'use strict';

/**
 * Fusión de varias capturas del mismo partido.
 *
 * Una captura del cliente trae agente, K/D/A, economía, spikes y desactivaciones;
 * una de Tracker del mismo mapa trae ADR, HS%, KAST, K/D, DDΔ y multikills.
 * Juntas dan un cuadro completo que ninguna de las dos da por su cuenta.
 *
 * ⚠️ Cuando dos capturas dicen cosas distintas NO se elige una en silencio. Pero
 * «distinto» no es lo mismo que «incompatible»: las dos fuentes redondean el ACS
 * de forma distinta y difieren en 1 sistemáticamente. Quién manda y cuánta
 * diferencia se admite lo decide `reconcile.js`, campo por campo y de forma
 * explícita, no una prioridad escondida aquí dentro.
 */

const { partirRiotId } = require('./parsers');
const { reconcileField, reconcileScore, SOURCE_OF_KIND } = require('./reconcile');

/** Campos de jugador que se concilian; lo que no esté aquí viaja en `extra`. */
const STAT_FIELDS = Object.freeze([
  'acs', 'kills', 'deaths', 'assists', 'plusMinus', 'kdRatio', 'ddDelta',
  'adr', 'hsPercent', 'kastPercent', 'firstKills', 'firstDeaths', 'multiKills',
  'economyRating', 'spikesPlanted', 'defuses'
]);

/** La clave con la que se reconoce a la misma persona entre capturas. */
function playerKey(jugador) {
  if (jugador.riotId) return jugador.riotId.toLowerCase();
  return String(jugador.gameName || jugador.raw || '').trim().toLowerCase();
}

/**
 * Junta a la misma persona aunque una captura traiga la etiqueta y la otra no.
 *
 * El cliente enseña «Luisbloom» y Tracker «Luisbloom#NANO»: son el mismo. Si se
 * tratan como dos, la tabla sale con veinte filas y ninguna completa.
 */
function agruparJugadores(apariciones) {
  const grupos = new Map();

  const buscarGrupo = (jugador) => {
    const conTag = jugador.riotId ? jugador.riotId.toLowerCase() : null;
    const sinTag = String(jugador.gameName || jugador.raw || '').trim().toLowerCase();

    if (conTag && grupos.has(conTag)) return conTag;
    if (grupos.has(sinTag)) return sinTag;

    // ¿Hay ya un grupo cuyo nombre coincide, con o sin etiqueta?
    for (const [clave, miembros] of grupos) {
      const nombre = String(miembros[0].jugador.gameName || '').trim().toLowerCase();
      if (nombre && nombre === sinTag) return clave;
    }
    return conTag ?? sinTag;
  };

  for (const aparicion of apariciones) {
    const clave = buscarGrupo(aparicion.jugador);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(aparicion);
  }

  emparejarSueltos(grupos);
  return grupos;
}

/** Cuánto se parecen dos nombres, de 0 a 1. */
function similitud(uno, otro) {
  if (uno === otro) return 1;
  if (!uno.length || !otro.length) return 0;
  let anterior = Array.from({ length: otro.length + 1 }, (_, i) => i);
  for (let i = 1; i <= uno.length; i++) {
    const actual = [i];
    for (let j = 1; j <= otro.length; j++) {
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1,
        anterior[j - 1] + (uno[i - 1] === otro[j - 1] ? 0 : 1));
    }
    anterior = actual;
  }
  return 1 - anterior[otro.length] / Math.max(uno.length, otro.length);
}

/**
 * Junta los que han quedado sueltos en una sola captura.
 *
 * Las dos capturas son de la MISMA partida, así que enseñan a las mismas diez
 * personas. Si un nombre aparece sólo en una y otro nombre parecido sólo en la
 * otra, es casi seguro la misma persona leída de dos formas: en la captura real
 * «Alvlp10» sale como «Atvip10» en una de las dos.
 *
 * ⚠️ Sólo se emparejan sueltos, y sólo si el parecido es MUTUAMENTE el mejor.
 * Sin esas dos condiciones se estarían fusionando jugadores distintos.
 */
const PARECIDO_MINIMO = 0.66;

function emparejarSueltos(grupos) {
  const sueltos = [...grupos.entries()]
    .filter(([, miembros]) => new Set(miembros.map((m) => m.source)).size === 1)
    .map(([clave, miembros]) => ({
      clave, miembros, source: miembros[0].source,
      nombre: String(miembros[0].jugador.gameName || '').toLowerCase()
    }))
    .filter((suelto) => suelto.nombre.length >= 4);

  const mejorDe = (suelto) => sueltos
    .filter((otro) => otro.source !== suelto.source)
    .map((otro) => ({ otro, puntos: similitud(suelto.nombre, otro.nombre) }))
    .sort((uno, otro) => otro.puntos - uno.puntos)[0];

  const usados = new Set();
  for (const suelto of sueltos) {
    if (usados.has(suelto.clave)) continue;
    const mejor = mejorDe(suelto);
    if (!mejor || mejor.puntos < PARECIDO_MINIMO) continue;
    if (usados.has(mejor.otro.clave)) continue;

    // Tiene que ser recíproco: si el candidato se parece más a un tercero, no.
    const reciproco = mejorDe(mejor.otro);
    if (!reciproco || reciproco.otro.clave !== suelto.clave) continue;

    grupos.set(suelto.clave, [...suelto.miembros, ...mejor.otro.miembros]);
    grupos.delete(mejor.otro.clave);
    usados.add(suelto.clave);
    usados.add(mejor.otro.clave);
  }
}

/**
 * @param {Array<{captureId: number, kind: string, parsed: object}>} capturas
 */
function mergeCaptures(capturas) {
  const utiles = (capturas || []).filter((captura) => captura.parsed);
  const conFuente = utiles.map((captura) => ({
    ...captura,
    source: SOURCE_OF_KIND[captura.kind] ?? null
  }));

  const conflictos = [];
  const variaciones = [];

  const conciliar = (field, observaciones) => {
    const resultado = reconcileField(field, observaciones);
    if (resultado.conflict) conflictos.push(resultado.conflict);
    if (resultado.variance) variaciones.push(resultado.variance);
    return resultado;
  };

  // --- mapa ---
  const mapa = conciliar('map', conFuente.map((captura) => ({
    source: captura.source, captureId: captura.captureId,
    value: captura.parsed.map?.key ?? null
  })));

  // --- marcador ---
  // Sólo Tracker orienta; la pantalla del cliente da el par sin saber de quién
  // es cada cifra, así que se comparan como conjunto.
  const orientadas = conFuente.filter((captura) =>
    captura.parsed.teamARounds !== null && captura.parsed.teamARounds !== undefined);
  const conPar = conFuente.filter((captura) => Array.isArray(captura.parsed.scorePair));

  const orientado = orientadas.length
    ? [orientadas[0].parsed.teamARounds, orientadas[0].parsed.teamBRounds]
    : null;
  const sinOrientar = conPar.find((captura) => !orientadas.includes(captura))?.parsed.scorePair
    ?? (conPar.length ? conPar[0].parsed.scorePair : null);

  const marcador = reconcileScore({ oriented: orientado, unordered: sinOrientar });
  if (marcador.code === 'SCORE_CONFLICT') {
    conflictos.push({
      field: 'score', values: marcador.values,
      sources: conFuente.map((captura) => captura.source)
    });
  }

  // Si dos capturas orientadas discrepan, eso sí es un conflicto duro.
  if (orientadas.length > 1) {
    conciliar('teamARounds', orientadas.map((captura) => ({
      source: captura.source, captureId: captura.captureId, value: captura.parsed.teamARounds
    })));
    conciliar('teamBRounds', orientadas.map((captura) => ({
      source: captura.source, captureId: captura.captureId, value: captura.parsed.teamBRounds
    })));
  }

  // --- jugadores ---
  const apariciones = conFuente.flatMap((captura) =>
    (captura.parsed.players || []).map((jugador) => ({
      captureId: captura.captureId, source: captura.source, jugador
    })));

  const jugadores = [...agruparJugadores(apariciones).values()].map((miembros) => {
    // El nombre más completo gana: si una captura trae el Riot ID entero y otra
    // sólo el nombre, nos quedamos con el entero.
    const conRiotId = miembros.find((miembro) => miembro.jugador.riotId);
    const identidad = partirRiotId(
      conRiotId?.jugador.riotId ?? miembros[0].jugador.raw ?? miembros[0].jugador.gameName ?? '');

    const stats = {};
    const observaciones = {};

    for (const campo of [...STAT_FIELDS, 'agent']) {
      const resultado = reconcileField(campo, miembros.map((miembro) => ({
        source: miembro.source, captureId: miembro.captureId, value: miembro.jugador[campo] ?? null
      })));

      if (resultado.conflict) {
        conflictos.push({ ...resultado.conflict, player: identidad.riotId ?? identidad.gameName });
      }
      if (resultado.variance) {
        variaciones.push({ ...resultado.variance, player: identidad.riotId ?? identidad.gameName });
      }

      stats[campo] = resultado.value;
      // Se guarda lo que dijo CADA fuente, también la que no manda: sin eso no
      // se puede averiguar después por qué un número no cuadraba.
      if (resultado.observations.length > 1
        || (resultado.observations.length === 1 && resultado.observations[0].value !== null)) {
        observaciones[campo] = resultado.observations;
      }
    }

    // El lado en el que salía, cuando alguna captura los separaba.
    const visualTeam = miembros.map((miembro) => miembro.jugador.visualTeam).find(Boolean) ?? null;

    return {
      ...identidad,
      raw: miembros[0].jugador.raw ?? identidad.gameName,
      visualTeam,
      ...stats,
      confidence: Math.min(1,
        miembros.reduce((total, m) => total + (m.jugador.confidence ?? 0.8), 0) / miembros.length
        + (miembros.length > 1 ? 0.05 : 0)),
      seenIn: miembros.map((miembro) => miembro.captureId),
      sources: [...new Set(miembros.map((miembro) => miembro.source).filter(Boolean))],
      observations: observaciones
    };
  });

  return {
    map: mapa.value,
    teamARounds: marcador.ok ? marcador.teamARounds : null,
    teamBRounds: marcador.ok ? marcador.teamBRounds : null,
    // Los nombres tal y como salían junto al marcador: en la pantalla de fin de
    // partida son lo único que dice qué cifra es de quién.
    teamNames: orientadas.length ? (orientadas[0].parsed.teamNames ?? []) : [],
    score: marcador,
    players: jugadores,
    conflicts: conflictos,
    // Discrepancias conocidas y admitidas: se registran, pero no bloquean.
    variances: variaciones,
    captureCount: conFuente.length
  };
}

module.exports = { mergeCaptures, playerKey, agruparJugadores, STAT_FIELDS };
