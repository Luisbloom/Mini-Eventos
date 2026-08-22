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

module.exports = { normalizeFriendCode, friendCodeFingerprint };
