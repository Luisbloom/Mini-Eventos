'use strict';

/**
 * El cuadro de eliminatorias, sin base de datos.
 *
 * Doble eliminación de verdad: hacen falta DOS derrotas para quedar fuera. Eso
 * obliga a una pieza que se olvida con facilidad —la **reposición de la gran
 * final**—, porque quien llega desde el cuadro alto lo hace sin ninguna derrota
 * y perder una vez no puede eliminarle.
 *
 * Todo aquí es una tabla de datos, no una cadena de condiciones: quién juega
 * cada ronda sale de decir de dónde viene cada hueco. Con `if (ronda === 3 &&
 * posicion === 2)` nadie sabe después qué partido es ése.
 */

/** Los huecos del cuadro. El identificador es estable y no depende del orden. */
const SLOTS = Object.freeze({
  UPPER_SEMI_1: 'UPPER_SEMI_1',
  UPPER_SEMI_2: 'UPPER_SEMI_2',
  UPPER_FINAL: 'UPPER_FINAL',
  LOWER_ROUND_1: 'LOWER_ROUND_1',
  LOWER_FINAL: 'LOWER_FINAL',
  GRAND_FINAL: 'GRAND_FINAL',
  GRAND_FINAL_RESET: 'GRAND_FINAL_RESET'
});

/**
 * De dónde sale cada participante.
 *
 * `seed` para los que vienen de la liga; `{ from, take }` para los que dependen
 * de otra serie. `order` es sólo para pintarlos y para ordenar la propagación.
 */
const PLAN = Object.freeze([
  {
    slot: SLOTS.UPPER_SEMI_1, order: 1, round: 1, bracket: 'UPPER',
    label: 'Semifinal alta 1',
    a: { seed: 1 }, b: { seed: 4 }
  },
  {
    slot: SLOTS.UPPER_SEMI_2, order: 2, round: 1, bracket: 'UPPER',
    label: 'Semifinal alta 2',
    a: { seed: 2 }, b: { seed: 3 }
  },
  {
    slot: SLOTS.LOWER_ROUND_1, order: 3, round: 2, bracket: 'LOWER',
    label: 'Ronda baja 1',
    a: { from: SLOTS.UPPER_SEMI_1, take: 'loser' },
    b: { from: SLOTS.UPPER_SEMI_2, take: 'loser' },
    // Quien pierde aquí acumula su segunda derrota.
    eliminates: 4
  },
  {
    slot: SLOTS.UPPER_FINAL, order: 4, round: 2, bracket: 'UPPER',
    label: 'Final alta',
    a: { from: SLOTS.UPPER_SEMI_1, take: 'winner' },
    b: { from: SLOTS.UPPER_SEMI_2, take: 'winner' }
  },
  {
    slot: SLOTS.LOWER_FINAL, order: 5, round: 3, bracket: 'LOWER',
    label: 'Final baja',
    a: { from: SLOTS.LOWER_ROUND_1, take: 'winner' },
    b: { from: SLOTS.UPPER_FINAL, take: 'loser' },
    eliminates: 3
  },
  {
    slot: SLOTS.GRAND_FINAL, order: 6, round: 4, bracket: 'GRAND',
    label: 'Gran final',
    a: { from: SLOTS.UPPER_FINAL, take: 'winner' },
    b: { from: SLOTS.LOWER_FINAL, take: 'winner' }
  },
  {
    slot: SLOTS.GRAND_FINAL_RESET, order: 7, round: 5, bracket: 'GRAND',
    label: 'Reposición de la gran final',
    // Sólo existe si hace falta, y entonces la juegan los mismos dos.
    a: { from: SLOTS.GRAND_FINAL, take: 'winner' },
    b: { from: SLOTS.GRAND_FINAL, take: 'loser' },
    conditional: true
  }
]);

/** Los huecos que se crean al generar el cuadro. La reposición no. */
const INITIAL_SLOTS = Object.freeze(PLAN.filter((p) => !p.conditional).map((p) => p.slot));

const planFor = (slot) => PLAN.find((entrada) => entrada.slot === slot) ?? null;

/** Qué huecos dependen de una serie, y con qué papel. */
function dependents(slot) {
  const salida = [];
  for (const entrada of PLAN) {
    for (const lado of ['a', 'b']) {
      if (entrada[lado]?.from === slot) {
        salida.push({ slot: entrada.slot, side: lado, take: entrada[lado].take });
      }
    }
  }
  return salida;
}

/**
 * Los dos emparejamientos de la primera ronda.
 *
 * El primero contra el cuarto y el segundo contra el tercero: al mejor de la
 * liga le toca el rival peor clasificado.
 */
function seedPairings(seeds) {
  if (!Array.isArray(seeds) || seeds.length !== 4) {
    throw new Error('El cuadro se monta con exactamente cuatro clasificados.');
  }
  if (new Set(seeds).size !== 4) {
    throw new Error('Hay un equipo repetido entre los clasificados.');
  }
  return {
    [SLOTS.UPPER_SEMI_1]: { a: seeds[0], b: seeds[3], seedA: 1, seedB: 4 },
    [SLOTS.UPPER_SEMI_2]: { a: seeds[1], b: seeds[2], seedA: 2, seedB: 3 }
  };
}

// ------------------------------------------------------------------ derrotas

/**
 * Cuántas veces ha perdido cada equipo, contado de las series terminadas.
 *
 * No se guarda en ninguna columna: se deriva. Un contador que se puede calcular
 * y además se almacena acaba discrepando de sus propios partidos.
 *
 * @param {Array<{slot:string, teamAId:number|null, teamBId:number|null, winnerTeamId:number|null, status:string}>} series
 */
function lossesByTeam(series) {
  const derrotas = new Map();
  for (const serie of series) {
    if (serie.status !== 'COMPLETED' || !serie.winnerTeamId) continue;
    const perdedor = serie.winnerTeamId === serie.teamAId ? serie.teamBId : serie.teamAId;
    if (!perdedor) continue;
    derrotas.set(perdedor, (derrotas.get(perdedor) ?? 0) + 1);
  }
  return derrotas;
}

/**
 * ⚠️ Si el ganador de la gran final viene del cuadro bajo, hay reposición.
 *
 * Quien sube por el cuadro alto llega sin ninguna derrota. Que pierda una vez
 * no puede dejarle fuera de un torneo donde hacen falta dos: si eso ocurriera,
 * la «doble eliminación» sería un nombre y no un formato.
 */
function needsReset(series) {
  const granFinal = series.find((s) => s.slot === SLOTS.GRAND_FINAL);
  const finalBaja = series.find((s) => s.slot === SLOTS.LOWER_FINAL);
  if (!granFinal || granFinal.status !== 'COMPLETED' || !granFinal.winnerTeamId) return false;
  if (!finalBaja || !finalBaja.winnerTeamId) return false;
  return granFinal.winnerTeamId === finalBaja.winnerTeamId;
}

/**
 * Cómo queda cada equipo cuando el cuadro está resuelto, o mientras se juega.
 *
 * @returns {{status: 'PENDING'|'COMPLETED', placements: Array, champion: number|null, runnerUp: number|null}}
 */
function standings(series) {
  const porSlot = new Map(series.map((serie) => [serie.slot, serie]));
  const derrotas = lossesByTeam(series);
  const puestos = new Map();

  const anotar = (teamId, posicion) => {
    if (teamId && !puestos.has(teamId)) puestos.set(teamId, posicion);
  };

  const perdedorDe = (slot) => {
    const serie = porSlot.get(slot);
    if (!serie || serie.status !== 'COMPLETED' || !serie.winnerTeamId) return null;
    return serie.winnerTeamId === serie.teamAId ? serie.teamBId : serie.teamAId;
  };

  anotar(perdedorDe(SLOTS.LOWER_ROUND_1), 4);
  anotar(perdedorDe(SLOTS.LOWER_FINAL), 3);

  // La última que se juega decide el título: la reposición si existe, y si no
  // la propia gran final.
  const reposicion = porSlot.get(SLOTS.GRAND_FINAL_RESET);
  const decisiva = reposicion && reposicion.status === 'COMPLETED'
    ? reposicion
    : porSlot.get(SLOTS.GRAND_FINAL);

  let campeon = null;
  let subcampeon = null;

  const pendienteDeReposicion = needsReset(series)
    && (!reposicion || reposicion.status !== 'COMPLETED');

  if (decisiva && decisiva.status === 'COMPLETED' && decisiva.winnerTeamId && !pendienteDeReposicion) {
    campeon = decisiva.winnerTeamId;
    subcampeon = decisiva.winnerTeamId === decisiva.teamAId ? decisiva.teamBId : decisiva.teamAId;
    anotar(campeon, 1);
    anotar(subcampeon, 2);
  }

  const equipos = new Set(series.flatMap((s) => [s.teamAId, s.teamBId]).filter(Boolean));
  const placements = [...equipos].map((teamId) => ({
    teamId,
    position: puestos.get(teamId) ?? null,
    losses: derrotas.get(teamId) ?? 0,
    // Dos derrotas dejan fuera. Con una todavía se sigue vivo, y eso es
    // justamente lo que distingue este formato del de eliminación directa.
    result: teamId === campeon ? 'CHAMPION'
      : teamId === subcampeon ? 'RUNNER_UP'
        : (derrotas.get(teamId) ?? 0) >= 2 ? 'ELIMINATED' : 'ACTIVE'
  })).sort((uno, otro) => (uno.position ?? 99) - (otro.position ?? 99));

  return {
    status: campeon ? 'COMPLETED' : 'PENDING',
    placements,
    champion: campeon,
    runnerUp: subcampeon
  };
}

module.exports = {
  SLOTS, PLAN, INITIAL_SLOTS, planFor, dependents,
  seedPairings, lossesByTeam, needsReset, standings
};
