'use strict';

/**
 * El cuadro de eliminatorias, sin base de datos.
 *
 * Doble eliminación para repartir los puestos, pero la GRAN FINAL va aparte.
 *
 * Hacen falta dos derrotas para caer del cuadro, así que una primera derrota
 * manda al cuadro bajo en vez de a casa. Lo que ya no hay es reposición de la
 * gran final: la final se juega a cero, sin arrastrar derrotas y sin ventaja
 * para quien llega invicto. Es una decisión deliberada de la organización —
 * cuesta que quien sube por arriba pueda caer con una sola derrota en la final,
 * y a cambio la final es una final y no «dos finales para uno de los dos».
 *
 * Y los dos que se quedan fuera no heredan el puesto del cuadro: lo juegan en
 * el partido por el TERCER PUESTO.
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
  THIRD_PLACE: 'THIRD_PLACE',
  GRAND_FINAL: 'GRAND_FINAL'
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
    /*
      El tercer puesto se juega, no se hereda.

      Lo disputan los dos que caen del cuadro: quien pierde la ronda baja 1 y
      quien pierde la final baja. Los dos llegan con sus dos derrotas, así que
      esta serie no elimina a nadie —ya están fuera del título— y sólo ordena
      el 3º del 4º.
    */
    slot: SLOTS.THIRD_PLACE, order: 6, round: 4, bracket: 'THIRD',
    label: 'Tercer y cuarto puesto',
    a: { from: SLOTS.LOWER_ROUND_1, take: 'loser' },
    b: { from: SLOTS.LOWER_FINAL, take: 'loser' }
  },
  {
    /*
      La gran final, aparte del cuadro.

      Los dos llegan a cero: el que viene del cuadro alto no tiene ventaja y al
      que viene del bajo le basta con ganarla una vez. Por eso no hay
      reposición, y por eso esta serie se juega con su propia regla —por
      diferencia de dos mapas— en vez de al mejor de tres.
    */
    slot: SLOTS.GRAND_FINAL, order: 7, round: 5, bracket: 'GRAND',
    label: 'Gran final',
    a: { from: SLOTS.UPPER_FINAL, take: 'winner' },
    b: { from: SLOTS.LOWER_FINAL, take: 'winner' }
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

  /*
    El 3º y el 4º salen de su partido, no de por dónde cayeron.

    Mientras ese partido no se juegue, los dos eliminados no tienen puesto: no
    se les adjudica uno provisional que luego habría que corregir.
  */
  const tercerPuesto = porSlot.get(SLOTS.THIRD_PLACE);
  if (tercerPuesto && tercerPuesto.status === 'COMPLETED' && tercerPuesto.winnerTeamId) {
    const tercero = tercerPuesto.winnerTeamId;
    const cuarto = tercero === tercerPuesto.teamAId ? tercerPuesto.teamBId : tercerPuesto.teamAId;
    anotar(tercero, 3);
    anotar(cuarto, 4);
  }

  // El título lo decide la gran final, y sólo ella: ya no hay reposición.
  const decisiva = porSlot.get(SLOTS.GRAND_FINAL);

  let campeon = null;
  let subcampeon = null;

  if (decisiva && decisiva.status === 'COMPLETED' && decisiva.winnerTeamId) {
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
    /*
      Dos derrotas te sacan de la pelea por el título, pero no del torneo: aún
      queda el partido por el tercer puesto. «Eliminado» aquí significa sin
      opción de ganar, no sin más partidos.
    */
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
  seedPairings, lossesByTeam, standings
};
