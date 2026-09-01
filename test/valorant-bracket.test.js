'use strict';

/**
 * El cuadro de eliminatorias, sin base de datos.
 *
 * Lo que se prueba aquí es la regla del formato: quién juega contra quién, a
 * dónde va cada ganador y cada perdedor, y las dos decisiones que lo definen:
 *
 * - Hacen falta DOS derrotas para caer del cuadro. La primera manda abajo.
 * - La GRAN FINAL va aparte: no hereda derrotas y no tiene reposición. El que
 *   sube por el cuadro alto no llega con ventaja, y al del bajo le basta con
 *   ganarla una vez.
 *
 * Y el 3º y el 4º no se heredan de por dónde cayó cada uno: se juegan.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SLOTS, PLAN, INITIAL_SLOTS, planFor, dependents,
  seedPairings, lossesByTeam, standings
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
function jugar({ usf1, usf2, lr1, uf, lf, gf, tercero }) {
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
  const perdedorBaja1 = lr1 === perdedor1 ? perdedor2 : perdedor1;
  series.push(serie(SLOTS.LOWER_FINAL, lr1, perdedorAlta, lf));
  if (!lf) return series;

  const perdedorBajaFinal = lf === lr1 ? perdedorAlta : lr1;
  series.push(serie(SLOTS.THIRD_PLACE, perdedorBaja1, perdedorBajaFinal, tercero));
  series.push(serie(SLOTS.GRAND_FINAL, uf, lf, gf));
  return series;
}

// ============================================================ EMPAREJAMIENTOS

describe('cómo se monta el cuadro', () => {
  it('el cuadro nace entero: siete series y ninguna condicional', () => {
    // Antes la reposición se creaba sobre la marcha porque podía no hacer
    // falta. Ya no existe, y el tercer puesto se juega siempre.
    assert.equal(PLAN.length, 7);
    assert.equal(INITIAL_SLOTS.length, 7);
    assert.ok(!PLAN.some((entrada) => entrada.conditional),
      'ninguna serie depende de que ocurra algo para existir');
    assert.ok(!Object.keys(SLOTS).includes('GRAND_FINAL_RESET'),
      'la reposición se retiró con la final aparte');
  });

  it('el primero contra el cuarto y el segundo contra el tercero', () => {
    const emparejamientos = seedPairings(SEEDS);
    assert.deepEqual(emparejamientos[SLOTS.UPPER_SEMI_1], { a: UNO, b: CUATRO, seedA: 1, seedB: 4 });
    assert.deepEqual(emparejamientos[SLOTS.UPPER_SEMI_2], { a: DOS, b: TRES, seedA: 2, seedB: 3 });
  });

  it('no se monta con un número de equipos que no sea cuatro', () => {
    assert.throws(() => seedPairings([UNO, DOS, TRES]), /exactamente cuatro/);
    assert.throws(() => seedPairings([UNO, DOS, TRES, CUATRO, 55]), /exactamente cuatro/);
  });

  it('ni con un equipo repetido', () => {
    assert.throws(() => seedPairings([UNO, DOS, TRES, UNO]), /repetido/);
  });

  it('cada hueco dice de dónde salen sus dos equipos', () => {
    for (const entrada of PLAN) {
      for (const lado of ['a', 'b']) {
        const origen = entrada[lado];
        assert.ok(origen.seed || (origen.from && origen.take),
          `${entrada.slot}.${lado} no dice de dónde viene`);
      }
    }
  });
});

// ============================================================== PROPAGACIÓN

describe('a dónde va cada uno', () => {
  const destinos = (slot) => dependents(slot)
    .map((d) => `${d.slot}:${d.take}`).sort();

  it('los ganadores de las semis altas van a la final alta', () => {
    assert.ok(destinos(SLOTS.UPPER_SEMI_1).includes(`${SLOTS.UPPER_FINAL}:winner`));
    assert.ok(destinos(SLOTS.UPPER_SEMI_2).includes(`${SLOTS.UPPER_FINAL}:winner`));
  });

  it('los perdedores de las semis altas NO se van a casa', () => {
    // Es la pieza que distingue este formato de la eliminación directa.
    assert.ok(destinos(SLOTS.UPPER_SEMI_1).includes(`${SLOTS.LOWER_ROUND_1}:loser`));
    assert.ok(destinos(SLOTS.UPPER_SEMI_2).includes(`${SLOTS.LOWER_ROUND_1}:loser`));
  });

  it('el perdedor de la final alta cae a la final baja', () => {
    assert.ok(destinos(SLOTS.UPPER_FINAL).includes(`${SLOTS.LOWER_FINAL}:loser`));
  });

  it('las dos finales desembocan en la gran final', () => {
    assert.ok(destinos(SLOTS.UPPER_FINAL).includes(`${SLOTS.GRAND_FINAL}:winner`));
    assert.ok(destinos(SLOTS.LOWER_FINAL).includes(`${SLOTS.GRAND_FINAL}:winner`));
  });

  it('los dos que caen del cuadro se cruzan en el tercer puesto', () => {
    assert.ok(destinos(SLOTS.LOWER_ROUND_1).includes(`${SLOTS.THIRD_PLACE}:loser`));
    assert.ok(destinos(SLOTS.LOWER_FINAL).includes(`${SLOTS.THIRD_PLACE}:loser`));
  });

  it('la gran final no alimenta a nadie: es la última', () => {
    assert.deepEqual(dependents(SLOTS.GRAND_FINAL), []);
  });
});

// ========================================================= LAS DOS DERROTAS

describe('la regla de las dos derrotas', () => {
  it('con una derrota se sigue vivo', () => {
    const series = jugar({ usf1: UNO, usf2: DOS });
    const tabla = standings(series);
    const cuarto = tabla.placements.find((fila) => fila.teamId === CUATRO);
    assert.equal(cuarto.losses, 1);
    assert.equal(cuarto.result, 'ACTIVE');
  });

  it('la segunda derrota saca de la pelea por el título', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: TRES });
    const tabla = standings(series);
    // CUATRO perdió su semi y la ronda baja: fuera del título.
    const cuarto = tabla.placements.find((fila) => fila.teamId === CUATRO);
    assert.equal(cuarto.losses, 2);
    assert.equal(cuarto.result, 'ELIMINATED');
  });

  it('las derrotas se cuentan de las series, no de un contador aparte', () => {
    const derrotas = lossesByTeam([
      serie(SLOTS.UPPER_SEMI_1, UNO, CUATRO, UNO),
      serie(SLOTS.UPPER_SEMI_2, DOS, TRES, DOS)
    ]);
    assert.equal(derrotas.get(CUATRO), 1);
    assert.equal(derrotas.get(TRES), 1);
    assert.equal(derrotas.get(UNO), undefined);
  });

  it('una serie sin terminar no cuenta como derrota de nadie', () => {
    const derrotas = lossesByTeam([serie(SLOTS.UPPER_SEMI_1, UNO, CUATRO)]);
    assert.equal(derrotas.size, 0);
  });
});

// ============================================================== GRAN FINAL

describe('la gran final va aparte', () => {
  const completo = (gf, tercero = TRES) => jugar({
    usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: TRES, gf, tercero
  });

  it('la gana el del cuadro alto y se acabó', () => {
    const tabla = standings(completo(UNO));
    assert.equal(tabla.champion, UNO);
    assert.equal(tabla.runnerUp, TRES);
    assert.equal(tabla.status, 'COMPLETED');
  });

  it('la gana el del cuadro bajo y también se acabó: no hay reposición', () => {
    /*
      Ésta es la decisión del formato. En doble eliminación pura, TRES llegaría
      con una derrota y UNO con ninguna, así que ganar una vez no bastaría. Aquí
      la final se juega a cero: quien la gana es campeón, venga de donde venga.
    */
    const tabla = standings(completo(TRES));
    assert.equal(tabla.champion, TRES);
    assert.equal(tabla.runnerUp, UNO);
    assert.equal(tabla.status, 'COMPLETED');
  });

  it('el campeón puede acabar con una derrota, y es correcto', () => {
    const tabla = standings(completo(TRES));
    const campeon = tabla.placements.find((fila) => fila.teamId === TRES);
    assert.equal(campeon.losses, 1, 'perdió su semifinal alta');
    assert.equal(campeon.result, 'CHAMPION');
  });

  it('sin final jugada no hay campeón', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: TRES });
    const tabla = standings(series);
    assert.equal(tabla.status, 'PENDING');
    assert.equal(tabla.champion, null);
  });
});

// ========================================================= TERCER Y CUARTO

describe('el tercer puesto se juega', () => {
  const conTercero = (tercero) => jugar({
    usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: TRES, gf: UNO, tercero
  });

  it('lo disputan los dos que cayeron del cuadro', () => {
    const series = conTercero(CUATRO);
    const partido = series.find((s) => s.slot === SLOTS.THIRD_PLACE);
    // CUATRO cayó en la ronda baja; DOS, en la final baja.
    assert.deepEqual([partido.teamAId, partido.teamBId].sort(), [DOS, CUATRO].sort());
  });

  it('el que lo gana es tercero, aunque hubiera caído antes', () => {
    /*
      CUATRO cayó una ronda antes que DOS. Con el puesto heredado del cuadro
      sería cuarto sin remedio; jugándolo, puede ser tercero.
    */
    const tabla = standings(conTercero(CUATRO));
    const puesto = (id) => tabla.placements.find((fila) => fila.teamId === id).position;
    assert.equal(puesto(CUATRO), 3);
    assert.equal(puesto(DOS), 4);
  });

  it('y al revés si lo gana el otro', () => {
    const tabla = standings(conTercero(DOS));
    const puesto = (id) => tabla.placements.find((fila) => fila.teamId === id).position;
    assert.equal(puesto(DOS), 3);
    assert.equal(puesto(CUATRO), 4);
  });

  it('mientras no se juegue, ninguno de los dos tiene puesto', () => {
    // No se les adjudica uno provisional que luego habría que corregir.
    const tabla = standings(conTercero(null));
    for (const id of [DOS, CUATRO]) {
      assert.equal(tabla.placements.find((fila) => fila.teamId === id).position, null);
    }
  });
});

// ========================================================== LAS POSICIONES

describe('las posiciones finales', () => {
  const torneoEntero = standings(jugar({
    usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO, lf: TRES, gf: UNO, tercero: DOS
  }));

  it('salen ordenadas del primero al cuarto', () => {
    assert.deepEqual(torneoEntero.placements.map((fila) => fila.position), [1, 2, 3, 4]);
  });

  it('con un campeón y un subcampeón claros', () => {
    assert.equal(torneoEntero.champion, UNO);
    assert.equal(torneoEntero.runnerUp, TRES);
    assert.deepEqual(
      torneoEntero.placements.map((fila) => fila.result),
      ['CHAMPION', 'RUNNER_UP', 'ELIMINATED', 'ELIMINATED']);
  });

  it('mientras el cuadro está a medias, sólo se sabe lo ya resuelto', () => {
    const series = jugar({ usf1: UNO, usf2: DOS, lr1: TRES, uf: UNO });
    const tabla = standings(series);
    assert.equal(tabla.status, 'PENDING');
    assert.ok(tabla.placements.every((fila) => fila.position === null),
      'sin final ni tercer puesto no hay ningún puesto que dar');
  });
});

// ================================================================== EL PLAN

describe('el plan es una tabla, no una cadena de condiciones', () => {
  it('cada serie tiene etiqueta, ronda y cuadro', () => {
    for (const entrada of PLAN) {
      assert.ok(entrada.label, `${entrada.slot} sin etiqueta`);
      assert.ok(Number.isInteger(entrada.round), `${entrada.slot} sin ronda`);
      assert.ok(['UPPER', 'LOWER', 'GRAND', 'THIRD'].includes(entrada.bracket),
        `${entrada.slot} en un cuadro desconocido: ${entrada.bracket}`);
    }
  });

  it('se puede preguntar por un hueco concreto', () => {
    assert.equal(planFor(SLOTS.GRAND_FINAL).label, 'Gran final');
    assert.equal(planFor(SLOTS.THIRD_PLACE).label, 'Tercer y cuarto puesto');
    assert.equal(planFor('NO_EXISTE'), null);
  });

  it('la gran final se juega después del tercer puesto', () => {
    // Para que el torneo no acabe con un partido que ya no decide el título.
    assert.ok(planFor(SLOTS.GRAND_FINAL).order > planFor(SLOTS.THIRD_PLACE).order);
  });
});
