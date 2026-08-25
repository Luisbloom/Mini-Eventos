'use strict';

/**
 * Reglas del marcador de Valorant.
 *
 * Comprobar sólo «enteros, no negativos y sin empate» deja pasar un 3-1, que no
 * es una partida: es alguien tecleando mal. Y un marcador inventado se cuela en
 * la clasificación sin que nadie lo note, porque las rondas cuentan para el
 * desempate.
 *
 * La regla vive aquí, en una función pura, y no dentro del endpoint: así se
 * prueba sin servidor y el día que el torneo juegue una custom con otra regla
 * se cambia la configuración, no el código.
 */

/**
 * Reglamento por defecto: primero a 13; si se llega a 12-12 hay prórroga y se
 * gana por dos.
 */
const DEFAULT_SCORE_POLICY = Object.freeze({
  roundsToWin: 13,
  overtime: true,
  winByTwo: true,
  maxRounds: 60          // tope de cordura: ninguna partida real llega ahí
});

/**
 * @returns {{ok: true, winner: 'a'|'b', overtime: boolean} | {ok: false, code: string, message: string}}
 */
function validateValorantScore(a, b, policy = DEFAULT_SCORE_POLICY) {
  const regla = { ...DEFAULT_SCORE_POLICY, ...(policy || {}) };
  const meta = Number(regla.roundsToWin);

  for (const [valor, quien] of [[a, 'A'], [b, 'B']]) {
    // Number('') es 0 y Number(null) también: hay que rechazarlos antes.
    if (typeof valor === 'boolean' || valor === null || valor === undefined
      || (typeof valor === 'string' && valor.trim() === '')
      || !Number.isInteger(Number(valor))) {
      return fallo('INVALID_ROUNDS', `Las rondas del equipo ${quien} tienen que ser un número entero.`);
    }
  }

  const uno = Number(a);
  const otro = Number(b);

  if (uno < 0 || otro < 0) {
    return fallo('INVALID_ROUNDS', 'Las rondas no pueden ser negativas.');
  }
  if (uno > regla.maxRounds || otro > regla.maxRounds) {
    return fallo('INVALID_ROUNDS', `Nadie juega más de ${regla.maxRounds} rondas.`);
  }
  if (uno === otro) {
    return fallo('SCORE_TIE', 'Una partida de Valorant no acaba en empate.');
  }

  const ganadas = Math.max(uno, otro);
  const perdidas = Math.min(uno, otro);
  const winner = uno > otro ? 'a' : 'b';

  // Sin prórroga: el ganador llega justo a la meta y el otro se queda corto.
  if (ganadas === meta && perdidas <= meta - 2) {
    return { ok: true, winner, overtime: false };
  }

  if (ganadas < meta) {
    return fallo('SCORE_INCOMPLETE',
      `La partida no está terminada: hacen falta ${meta} rondas para ganar y el marcador es ${uno}-${otro}.`);
  }

  if (!regla.overtime) {
    return fallo('SCORE_INVALID', `Este torneo no juega prórroga: el resultado tiene que ser ${meta}-X.`);
  }

  // En prórroga se empieza desde el empate a meta-1, así que el ganador pasa de
  // la meta y hay que ganar por dos.
  if (perdidas < meta - 1) {
    return fallo('SCORE_INVALID',
      `Un ${uno}-${otro} no es posible: sólo se pasa de ${meta} rondas tras un empate a ${meta - 1}.`);
  }
  const diferencia = ganadas - perdidas;
  if (regla.winByTwo && diferencia !== 2) {
    return fallo('SCORE_INVALID',
      diferencia < 2
        ? `En prórroga hay que ganar por dos: ${uno}-${otro} no cierra la partida.`
        : `En prórroga se gana por dos exactas: ${uno}-${otro} no es un marcador posible.`);
  }
  if (!regla.winByTwo && diferencia < 1) {
    return fallo('SCORE_INVALID', 'El ganador tiene que tener más rondas.');
  }

  return { ok: true, winner, overtime: true };
}

function fallo(code, message) {
  return { ok: false, code, message };
}

module.exports = { validateValorantScore, DEFAULT_SCORE_POLICY };
