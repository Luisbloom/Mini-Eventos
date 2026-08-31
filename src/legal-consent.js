'use strict';

/**
 * El consentimiento de quien se inscribe.
 *
 * La política de privacidad dice que la base legal del tratamiento es **tu
 * consentimiento al inscribirte**. Afirmarlo sin recogerlo deja la promesa sin
 * respaldo: si alguien pregunta cuándo aceptó y qué aceptó, hay que poder
 * responder con una fecha y una versión, no con «se lo dijimos en una página».
 *
 * Por eso el consentimiento:
 *
 * - Es una acción **afirmativa**: una casilla que hay que marcar. Nunca viene
 *   marcada de antemano, porque una casilla premarcada no es consentimiento.
 * - Se comprueba **en el servidor**. Lo que el navegador enseñe es cortesía;
 *   lo que vale es lo que llega.
 * - Se **guarda** con el momento y la versión aceptada.
 */

/**
 * Cambia esta fecha cuando cambien la política o los términos de forma que
 * afecte a lo que la gente aceptó. Así se sabe quién aceptó qué.
 */
const LEGAL_VERSION = '2026-08-31';

class ConsentError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'ConsentError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Lo que llega del navegador para el consentimiento.
 *
 * Se acepta `true` y también `'true'` o `'on'`, que es lo que manda un
 * formulario HTML sin JavaScript. Cualquier otra cosa —incluido no mandar
 * nada— es que no ha aceptado.
 */
function hasAccepted(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

/**
 * Devuelve lo que hay que guardar, o lanza si no ha aceptado.
 * @returns {{acceptedAt: string, version: string}}
 */
function requireConsent(value, { now = new Date() } = {}) {
  if (!hasAccepted(value)) {
    throw new ConsentError(
      'Tienes que aceptar los términos y la política de privacidad para inscribirte.',
      'CONSENT_REQUIRED');
  }
  return { acceptedAt: now.toISOString(), version: LEGAL_VERSION };
}

module.exports = { LEGAL_VERSION, ConsentError, hasAccepted, requireConsent };
