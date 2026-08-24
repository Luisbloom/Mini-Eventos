'use strict';

const crypto = require('node:crypto');

// Un mismo Friend Code puede escribirse de varias formas según la plataforma
// (`jugador:1234` en unas, `Jugador#1234` en otras). Se guarda y se compara
// siempre normalizado para que el jugador pueda escribirlo como quiera en el
// formulario y el Reporter lo siga reconociendo.
function normalizeFriendCode(value) {
  return String(value ?? '').replace(/:/g, '#').trim().toLocaleLowerCase('en');
}

// El backend nunca envía Friend Codes al Reporter: manda esta huella y el mod
// calcula la misma con el código que ve en el lobby.
function friendCodeFingerprint(value) {
  const normalized = normalizeFriendCode(value);
  return normalized ? crypto.createHash('sha256').update(normalized, 'utf8').digest('hex') : null;
}

// Se rechaza sólo lo que consta que está mal. De los dos errores reales que
// hemos visto, uno fue escribir el nombre de partida sin almohadilla —eso se
// caza aquí— y el otro un dígito cambiado, que ningún formato puede detectar.
// Exigir un número exacto de dígitos añadiría poca protección y sí el riesgo
// de rechazar un código legítimo.
const FRIEND_CODE_PATTERN = /^[a-z0-9._-]+#[0-9]{1,6}$/;

// Los 17 códigos observados en los registros del juego tienen exactamente
// cuatro dígitos. Lo que se salga de ahí no se bloquea, se marca para que
// administración lo mire antes del torneo.
const FRIEND_CODE_USUAL = /^[a-z]+#[0-9]{4}$/;

function looksUnusual(value) {
  const normalized = normalizeFriendCode(value);
  return Boolean(normalized) && !FRIEND_CODE_USUAL.test(normalized);
}

// Devuelve por qué un código no vale, en vez de un simple booleano: el motivo
// se convierte en el mensaje que lee quien se está inscribiendo.
function describeFriendCode(value) {
  const normalized = normalizeFriendCode(value);
  if (!normalized) return { ok: false, normalized: null, code: 'EMPTY' };
  if (!normalized.includes('#')) return { ok: false, normalized, code: 'MISSING_HASH' };
  if (!FRIEND_CODE_PATTERN.test(normalized)) return { ok: false, normalized, code: 'FORMAT' };
  return { ok: true, normalized, code: null };
}

// El caso real que motivó esto: alguien escribió su nombre de partida en vez
// del código y se descubrió al revisar los inscritos, no al inscribirse.
const FRIEND_CODE_MESSAGES = Object.freeze({
  EMPTY: 'Escribe tu Friend Code de Among Us.',
  MISSING_HASH: 'Eso parece tu nombre, no tu Friend Code. El código lleva almohadilla y cuatro números, por ejemplo jugador#1234. Lo tienes en Cuenta > Friend Code.',
  FORMAT: 'El Friend Code debe ser una palabra seguida de almohadilla y números, por ejemplo jugador#1234.'
});

function friendCodeError(code) {
  return FRIEND_CODE_MESSAGES[code] || FRIEND_CODE_MESSAGES.FORMAT;
}

module.exports = {
  normalizeFriendCode, friendCodeFingerprint, describeFriendCode,
  friendCodeError, looksUnusual, FRIEND_CODE_PATTERN, FRIEND_CODE_USUAL
};

