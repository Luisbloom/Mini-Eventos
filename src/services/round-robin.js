'use strict';

/**
 * Calendario de todos contra todos por el método del círculo.
 *
 * Con un número impar de equipos se añade uno fantasma: a quien le toque contra
 * él, descansa esa jornada. Así el mismo algoritmo sirve para 4, 5 y 6 sin
 * casos especiales, y cada equipo descansa exactamente una vez.
 *
 * Determinista: los mismos equipos en el mismo orden dan siempre el mismo
 * calendario, para poder regenerarlo y comprobarlo.
 */

const DESCANSA = null;

/**
 * @param {Array<number|string>} teamIds en el orden que decida la organización
 * @returns {Array<{matchday:number, matches:Array<{home,away}>, bye:*}>}
 */
function roundRobinSchedule(teamIds) {
  const equipos = [...(teamIds || [])];
  if (equipos.length < 2) {
    throw new Error('Hacen falta al menos dos equipos para un calendario.');
  }
  if (new Set(equipos.map(String)).size !== equipos.length) {
    throw new Error('Hay equipos repetidos en el calendario.');
  }

  // Con impares entra el fantasma: quien le toque, descansa.
  const impar = equipos.length % 2 === 1;
  const ruedan = impar ? [...equipos, DESCANSA] : [...equipos];
  const n = ruedan.length;
  const jornadas = n - 1;
  const porJornada = n / 2;

  // Dónde queda cada equipo en la lista, para ordenar las parejas igual que
  // las publica el documento del torneo: primero el que va antes.
  const puesto = new Map(equipos.map((equipo, indice) => [equipo, indice]));

  const rondas = [];
  // El primero se queda fijo y los demás rotan a su alrededor.
  const orden = [...ruedan];

  for (let jornada = 0; jornada < jornadas; jornada++) {
    const partidos = [];
    let descansa = null;

    for (let i = 0; i < porJornada; i++) {
      const uno = orden[i];
      const otro = orden[n - 1 - i];
      if (uno === DESCANSA) { descansa = otro; continue; }
      if (otro === DESCANSA) { descansa = uno; continue; }
      partidos.push(puesto.get(uno) <= puesto.get(otro)
        ? { home: uno, away: otro }
        : { home: otro, away: uno });
    }

    // Dentro de la jornada, los partidos también en orden de equipo.
    partidos.sort((a, b) => puesto.get(a.home) - puesto.get(b.home));
    rondas.push({ matches: partidos, bye: descansa });

    // Rotación: el primero quieto, el resto gira una posición.
    const [fijo, ...resto] = orden;
    resto.unshift(resto.pop());
    orden.length = 0;
    orden.push(fijo, ...resto);
  }

  /*
    El método del círculo empieza a rotar por donde quiera, y sale el primer
    equipo enfrentándose al último en la jornada 1. El documento del torneo lo
    publica al revés —cada equipo va conociendo rivales en orden— así que se
    invierte el orden de las jornadas para que la web y el PDF digan lo mismo.
    Invertir jornadas no cambia el calendario: sigue jugando cada uno contra
    cada uno, y cada equipo descansa exactamente una vez.
  */
  return rondas.reverse().map((ronda, indice) => ({
    matchday: indice + 1, matches: ronda.matches, bye: ronda.bye
  }));
}

/** Resumen para enseñar antes de generar y para comprobar en pruebas. */
function scheduleSummary(teamCount) {
  const equipos = Number(teamCount) || 0;
  const impar = equipos % 2 === 1;
  const jornadas = impar ? equipos : equipos - 1;
  return {
    teamCount: equipos,
    matchdays: jornadas,
    matchesPerMatchday: Math.floor(equipos / 2),
    totalMatches: (equipos * (equipos - 1)) / 2,
    matchesPerTeam: equipos - 1,
    hasByes: impar
  };
}

module.exports = { roundRobinSchedule, scheduleSummary };
