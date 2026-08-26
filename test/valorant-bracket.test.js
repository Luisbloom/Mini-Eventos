'use strict';

/**
 * El cuadro de eliminatorias, sin base de datos.
 *
 * Lo que se prueba aquí es la regla del formato: quién juega contra quién, a
 * dónde va cada ganador y cada perdedor, y —lo que más se olvida— que hagan
 * falta DOS derrotas para quedar fuera.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SLOTS, PLAN, INITIAL_SLOTS, planFor, dependents,
  seedPairings, lossesByTeam, needsReset, standings
} = require('../src/services/playoffs/bracket');

/** Cuatro equipos con identificadores fáciles de seguir. */
const [UNO, DOS, TRES, CUATRO] = [11, 22, 33, 44];
const SEEDS = [UNO, DOS, TRES, CUATRO];

/** Una serie terminada, tal y como la ve el cuadro. */
const serie = (slot, teamAId, teamBId, winnerTeamId = null) => ({
  slot, teamAId, teamBId, winnerTeamId,
  status: winnerTeamId ? 'COMPLETED' : 'READY'
});

/**
 * Juega el cuadro entero decidiendo quién gana cada ronda.
 *
 * Devuelve las series como quedarían en la base, para poder preguntarle al
 * módulo por las posiciones finales.
 */
function jugar({ usf1, usf2, lr1, uf, lf, gf, reset }) {
  const emparejamientos = seedPairings(SEEDS);
  const a = emparejamientos[SLOTS.UPPER_SEMI_1];
  const b = emparejamientos[SLOTS.UPPER_SEMI_2];

  const otro = (pareja, ganador) => (ganador === pareja.a ? pareja.b : pareja.a);

  const series = [
    serie(SLOTS.UPPER_SEMI_1, a.a, a.b, usf1),
    serie(SLOTS.UPPER_SEMI_2, b.a, b.b, usf2)
  ];
  if (!usf1 || !usf2) return series;

  const perdedor1 = otro(a, usf1);
  const perdedor2 = otro(b, usf2);

  series.push(serie(SLOTS.LOWER_ROUND_1, perdedor1, perdedor2, lr1));
  series.push(serie(SLOTS.UPPER_FINAL, usf1, usf2, uf));
  if (!lr1 || !uf) return series;

  const perdedorAlta = uf === usf1 ? usf2 : usf1;
  series.push(serie(SLOTS.LOWER_FINAL, lr1, perdedorAlta, lf));
  if (!lf) return series;

  series.push(serie(SLOTS.GRAND_FINAL, uf, lf, gf));
  if (!gf) return series;

  if (needsReset(series)) {
    const perdedorGf = gf === uf ? lf : uf;
    series.push(serie(SLOTS.GRAND_FINAL_RESET, gf, perdedorGf, reset));
  }
  return series;
}

// ============================================================ EMPAREJAMIENTOS

describe('cómo se monta el cuadro', () => {
  it('el primero contra el cuarto y el segundo contra el tercero', () => {
    const parejas = seedPairings(SEEDS);
    assert.deepEqual(parejas[SLOTS.UPPER_SEMI_1], { a: UNO, b: CUATRO, seedA: 1, seedB: 4 });
    assert.deepEqual(parejas[SLOTS.UPPER_SEMI_2], { a: DOS, b: TRES, seedA: 2, seedB: 3 });
  });

  it('hacen falta exactamente cuatro, y distintos', () => {
    assert.throws(() => seedPairings([UNO, DOS, TRES]));
    assert.throws(() => seedPairings([UNO, DOS, TRES, CUATRO, 55]));
    assert.throws(() => seedPairings([UNO, DOS, TRES, UNO]));
  });

  it('el cuadro nace con seis series; la reposición no', () => {
    assert.equal(INITIAL_SLOTS.length, 6);
    assert.equal(INITIAL_SLOTS.includes(SLOTS.GRAND_FINAL_RESET), false,
      'la reposición sólo existe si hace falta');
    assert.equal(planFor(SLOTS.GRAND_FINAL_RESET).conditional, true);
  });

  it('cada hueco dice de dónde salen sus dos equipos', () => {
    // Sin esto habría que deducirlo de números de ronda y posiciones, y nadie
    // sabría después qué partido es cuál.
    for (const entrada of PLAN) {
      assert.ok(entrada.a && entrada.b, `${entrada.slot} sin participantes definidos`);
      for (const lado of ['a', 'b']) {
        const origen = entrada[lado];
        assert.ok(origen.seed || (origen.from && ['winner', 'loser'].includes(origen.take)),
          `${entrada.slot}.${lado} no dice de dónde viene`);
      }
    }
  });
});

// ============================================================== PROPAGACIÓN

describe('a dónde va cada uno', () => {
  it('los ganadores de las semis altas van a la final alta', () => {
    const destinos = dependents(SLOTS.UPPER_SEMI_1);
    assert.deepEqual(destinos.find((d) => d.take === 'winner'),
      { slot: SLOTS.UPPER_FINAL, side: 'a', take: 'winner' });
    assert.deepEqual(dependents(SLOTS.UPPER_SEMI_2).find((d) => d.take === 'winner'),
      { slot: SLOTS.UPPER_FINAL, side: 'b', take: 'winner' });
  });

  it('los perdedores de las semis altas NO se van a casa', () => {
    // Es el formato entero: una derrota no elimina.
    for (const [slot, lado] of [[SLOTS.UPPER_SEMI_1, 'a'], [SLOTS.UPPER_SEMI_2, 'b']]) {
      assert.deepEqual(dependents(slot).find((d) => d.take === 'loser'),
        { slot: SLOTS.LOWER_ROUND_1, side: lado, take: 'loser' });
    }
  });

  it('el perdedor de la final alta cae a la final baja', () => {
    assert.deepEqual(dependents(SLOTS.UPPER_FINAL).find((d) => d.take === 'loser'),
      { slot: SLOTS.LOWER_FINAL, side: 'b', take: 'loser' });
    assert.deepEqual(dependents(SLOTS.UPPER_FINAL).find((d) => d.take === 'winner'),
      { slot: SLOTS.GRAND_FINAL, side: 'a', take: 'winner' });
  });

  it('las dos finales desembocan en la gran final', () => {
    assert.deepEqual(dependents(SLOTS.LOWER_FINAL).find((d) => d.take === 'winner'),
      { slot: SLOTS.GRAND_FINAL, side: 'b', take: 'winner' });
  });

  it('de la ronda baja 1 y de la final baja se sale eliminado', () => {
    assert.equal(planFor(SLOTS.LOWER_ROUND_1).eliminates, 4);
    assert.equal(planFor(SLOTS.LOWER_FINAL).eliminates, 3);
    assert.equal(dependents(SLOTS.LOWER_ROUND_1).some((d) => d.take === 'loser'), false);
  });
});

// ============================================================== DERROTAS

describe('la regla de las dos derrotas', () => {
  it('con una derrota se sigue vivo', () => {
    // El primero pierde su semi y baja al cuadro bajo: sigue en el torneo.
    const series = jugar({ usf1: CUATRO, usf2: DOS });
    const tabla = standings(series);
    const primero = tabla.placements.find((f) => f.teamId === UNO);
    assert.equal(primero.losses, 1);
    assert.equal(primero.result, 'ACTIVE', 'una derrota no elimina a nadie');
  });

  it('la segunda derrota sí elimina', () => {
    // Pierde la semi y después la ronda baja.
    const series = jugar({ usf1: CUATRO, usf2: DOS, lr1: TRES, uf: CUATRO });
    const tabla = standings(series);
    const primero = tabla.placements.find((f) => f.teamId === UNO);
    assert.equal(primero.losses, 2);
    assert.equal(primero.result, 'ELIMINATED');
    assert.equal(primero.position, 4, 'quien cae en la ronda baja 1 es cuarto');
  });

  it('las derrotas se cuentan de las series, no de un contador aparte', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO });
    const derrotas = lossesByTeam(series);
    assert.equal(derrotas.get(CUATRO), 2, 'perdió la semi y la ronda baja');
    assert.equal(derrotas.get(TRES), 1, 'perdió la semi y ganó la ronda baja');
    assert.equal(derrotas.get(DOS), 1, 'perdió la final alta');
    assert.equal(derrotas.get(UNO), undefined, 'no ha perdido ninguna');
  });

  it('una serie sin terminar no cuenta como derrota de nadie', () => {
    const series = [serie(SLOTS.UPPER_SEMI_1, UNO, CUATRO, null)];
    assert.equal(lossesByTeam(series).size, 0);
  });
});

// =========================================================== GRAN FINAL

describe('la gran final', () => {
  /** Camino A: gana quien venía del cuadro alto. */
  const caminoSinReposicion = () => jugar({
    usf1: UNO, usf2: DOS,      // ganan el 1 y el 2
    lr1: TRES, uf: UNO,        // el 3 sobrevive abajo; el 1 gana la final alta
    lf: DOS,                   // el 2 gana la final baja
    gf: UNO                    // y el 1 cierra sin reposición
  });

  /** Camino B: gana quien venía del cuadro bajo, y hay que repetir. */
  const caminoConReposicion = (reset) => jugar({
    usf1: UNO, usf2: DOS,
    lr1: TRES, uf: UNO,
    lf: DOS,
    gf: DOS,                   // gana el que llegaba con una derrota
    reset
  });

  it('camino A · gana el del cuadro alto y no hay reposición', () => {
    const series = caminoSinReposicion();
    assert.equal(needsReset(series), false);
    assert.equal(series.some((s) => s.slot === SLOTS.GRAND_FINAL_RESET), false);

    const tabla = standings(series);
    assert.equal(tabla.status, 'COMPLETED');
    assert.equal(tabla.champion, UNO);
    assert.equal(tabla.runnerUp, DOS);

    const campeon = tabla.placements.find((f) => f.teamId === UNO);
    const subcampeon = tabla.placements.find((f) => f.teamId === DOS);
    assert.equal(campeon.losses, 0, 'el campeón no perdió ninguna');
    assert.equal(subcampeon.losses, 2, 'el subcampeón cae con su segunda');
    assert.equal(subcampeon.result, 'RUNNER_UP');
  });

  it('camino B · gana el del cuadro bajo y HAY reposición', () => {
    const series = caminoConReposicion(null);
    assert.equal(needsReset(series), true);

    const reposicion = series.find((s) => s.slot === SLOTS.GRAND_FINAL_RESET);
    assert.ok(reposicion, 'tiene que aparecer la reposición');
    assert.equal(reposicion.status, 'READY');

    // ⚠️ Lo que justifica la reposición: los dos llegan con UNA derrota.
    const derrotas = lossesByTeam(series);
    assert.equal(derrotas.get(UNO), 1, 'el del cuadro alto acaba de perder la primera');
    assert.equal(derrotas.get(DOS), 1, 'el del cuadro bajo seguía con la suya');

    // Y mientras no se juegue, no hay campeón.
    const tabla = standings(series);
    assert.equal(tabla.status, 'PENDING');
    assert.equal(tabla.champion, null);
  });

  it('camino B · la reposición decide el título', () => {
    const series = caminoConReposicion(DOS);
    const tabla = standings(series);

    assert.equal(tabla.status, 'COMPLETED');
    assert.equal(tabla.champion, DOS, 'quien gana la reposición es campeón');
    assert.equal(tabla.runnerUp, UNO);
    assert.equal(tabla.placements.find((f) => f.teamId === UNO).losses, 2,
      'el subcampeón termina con dos derrotas');
  });

  it('camino B · también puede ganarla el que venía del cuadro alto', () => {
    const series = caminoConReposicion(UNO);
    const tabla = standings(series);
    assert.equal(tabla.champion, UNO);
    assert.equal(tabla.runnerUp, DOS);
    assert.equal(tabla.placements.find((f) => f.teamId === DOS).losses, 2);
  });

  it('nadie termina campeón con dos derrotas', () => {
    for (const series of [caminoSinReposicion(), caminoConReposicion(DOS), caminoConReposicion(UNO)]) {
      const tabla = standings(series);
      if (!tabla.champion) continue;
      const campeon = tabla.placements.find((f) => f.teamId === tabla.champion);
      assert.ok(campeon.losses <= 1, 'el campeón no puede haber perdido dos veces');
    }
  });
});

// =========================================================== POSICIONES

describe('las posiciones finales', () => {
  it('cuarto el que cae en la ronda baja, tercero el de la final baja', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: DOS, gf: UNO });
    const tabla = standings(series);
    const posicion = (teamId) => tabla.placements.find((f) => f.teamId === teamId).position;

    assert.equal(posicion(UNO), 1);
    assert.equal(posicion(DOS), 2);
    assert.equal(posicion(TRES), 3, 'perdió la final baja');
    assert.equal(posicion(CUATRO), 4, 'perdió la ronda baja 1');
  });

  it('mientras el cuadro está a medias, sólo se sabe lo ya resuelto', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO });
    const tabla = standings(series);
    assert.equal(tabla.status, 'PENDING');
    assert.equal(tabla.champion, null);
    assert.equal(tabla.placements.find((f) => f.teamId === CUATRO).position, 4,
      'el cuarto ya se conoce');
    assert.equal(tabla.placements.find((f) => f.teamId === DOS).position, null,
      'los demás todavía no');
  });

  it('las posiciones salen ordenadas', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: DOS, gf: UNO });
    const posiciones = standings(series).placements.map((f) => f.position);
    assert.deepEqual(posiciones, [1, 2, 3, 4]);
  });
});
