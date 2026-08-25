'use strict';

/**
 * Fusión de varias capturas del mismo partido.
 *
 * Una captura de Valorant trae mapa, marcador y K/D/A; una de Tracker de ese
 * mismo mapa trae además ADR, HS% y KAST. Juntas dan un cuadro completo.
 *
 * ⚠️ Cuando dos capturas dicen cosas distintas NO se elige una en silencio.
 * Una regla de prioridad escondida —«Tracker manda»— es exactamente lo que hace
 * que un resultado equivocado entre sin que nadie se entere. Se marca el
 * conflicto y lo resuelve quien está mirando.
 */

const { partirRiotId } = require('./parsers');

/** Campos de jugador que se fusionan; el resto viaja en `extra`. */
const STAT_FIELDS = Object.freeze([
  'acs', 'kills', 'deaths', 'assists', 'plusMinus',
  'adr', 'hsPercent', 'kastPercent', 'firstKills', 'firstDeaths'
]);

const presente = (valor) => valor !== null && valor !== undefined;

/**
 * Junta un valor que aparece en varias capturas.
 *
 * @returns {{value: *, sources: number[], conflict: null|{values: *[], sources: number[]}}}
 */
function mergeValue(aportaciones) {
  const conDato = aportaciones.filter((aporte) => presente(aporte.value));
  if (conDato.length === 0) {
    // Nadie lo vio. Null, no cero: son cosas distintas.
    return { value: null, sources: [], conflict: null };
  }

  const distintos = [...new Set(conDato.map((aporte) => JSON.stringify(aporte.value)))];
  if (distintos.length === 1) {
    return { value: conDato[0].value, sources: conDato.map((a) => a.captureId), conflict: null };
  }

  // Discrepan. Se queda el primero para poder enseñar algo, pero marcado: la
  // previsualización lo destaca y no se puede confirmar sin mirarlo.
  return {
    value: conDato[0].value,
    sources: conDato.map((aporte) => aporte.captureId),
    conflict: {
      values: distintos.map((texto) => JSON.parse(texto)),
      sources: conDato.map((aporte) => aporte.captureId)
    }
  };
}

/** La clave con la que se reconoce a la misma persona entre capturas. */
function playerKey(jugador) {
  if (jugador.riotId) return jugador.riotId.toLowerCase();
  return String(jugador.gameName || jugador.raw || '').trim().toLowerCase();
}

/**
 * @param {Array<{captureId: number, kind: string, parsed: object}>} capturas
 */
function mergeCaptures(capturas) {
  const utiles = capturas.filter((captura) => captura.parsed);
  const conflictos = [];

  const anota = (field, fusion) => {
    if (fusion.conflict) {
      conflictos.push({ field, values: fusion.conflict.values, sources: fusion.conflict.sources });
    }
    return fusion;
  };

  const mapa = anota('map', mergeValue(utiles.map((captura) => ({
    captureId: captura.captureId, value: captura.parsed.map?.key ?? null
  }))));

  const rondasA = anota('teamARounds', mergeValue(utiles.map((captura) => ({
    captureId: captura.captureId, value: captura.parsed.teamARounds
  }))));

  const rondasB = anota('teamBRounds', mergeValue(utiles.map((captura) => ({
    captureId: captura.captureId, value: captura.parsed.teamBRounds
  }))));

  // --- jugadores ---
  const porJugador = new Map();
  for (const captura of utiles) {
    for (const jugador of captura.parsed.players || []) {
      const clave = playerKey(jugador);
      if (!clave) continue;
      if (!porJugador.has(clave)) porJugador.set(clave, []);
      porJugador.get(clave).push({ captureId: captura.captureId, jugador });
    }
  }

  const jugadores = [...porJugador.entries()].map(([clave, apariciones]) => {
    // El nombre más completo gana: si una captura trae el Riot ID entero y otra
    // sólo el nombre, nos quedamos con el entero.
    const conRiotId = apariciones.find((aparicion) => aparicion.jugador.riotId);
    const identidad = partirRiotId(
      conRiotId?.jugador.riotId ?? apariciones[0].jugador.raw ?? clave);

    const stats = {};
    const sources = {};
    for (const campo of STAT_FIELDS) {
      const fusion = mergeValue(apariciones.map((aparicion) => ({
        captureId: aparicion.captureId, value: aparicion.jugador[campo] ?? null
      })));
      if (fusion.conflict) {
        conflictos.push({
          field: `${identidad.riotId ?? identidad.gameName}.${campo}`,
          values: fusion.conflict.values,
          sources: fusion.conflict.sources
        });
      }
      stats[campo] = fusion.value;
      if (fusion.sources.length) sources[campo] = fusion.sources;
    }

    const agente = mergeValue(apariciones.map((aparicion) => ({
      captureId: aparicion.captureId, value: aparicion.jugador.agent ?? null
    })));
    if (agente.conflict) {
      conflictos.push({
        field: `${identidad.riotId ?? identidad.gameName}.agent`,
        values: agente.conflict.values, sources: agente.conflict.sources
      });
    }

    return {
      ...identidad,
      raw: apariciones[0].jugador.raw,
      agent: agente.value,
      ...stats,
      // Cuantas más capturas coincidan, más se puede confiar.
      confidence: Math.min(1,
        apariciones.reduce((total, a) => total + (a.jugador.confidence ?? 0.8), 0) / apariciones.length
        + (apariciones.length > 1 ? 0.05 : 0)),
      seenIn: apariciones.map((aparicion) => aparicion.captureId),
      fieldSources: sources
    };
  });

  return {
    map: mapa.value,
    teamARounds: rondasA.value,
    teamBRounds: rondasB.value,
    players: jugadores,
    conflicts: conflictos,
    captureCount: utiles.length
  };
}

module.exports = { mergeCaptures, mergeValue, playerKey, STAT_FIELDS };
