'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/database');
const { describeFriendCode, normalizeFriendCode, looksUnusual } = require('../src/services/friend-code');

describe('friend code', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  function database() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-fc-'));
    directories.push(directory);
    return openDatabase(path.join(directory, 'tournament.db'));
  }

  function inscribir(db, eventId, nombre, codigo) {
    return db.createParticipant(eventId, { discord_username: nombre, game_name: nombre, friend_code: codigo });
  }

  it('rejects the game name written instead of the code', () => {
    // El caso real: alguien escribió "Pamari" en el campo del Friend Code y se
    // descubrió revisando los inscritos, no al inscribirse.
    assert.equal(describeFriendCode('Pamari').code, 'MISSING_HASH');
    assert.equal(describeFriendCode('').code, 'EMPTY');
    assert.equal(describeFriendCode('sinnumeros#abc').code, 'FORMAT');
  });

  it('accepts the shapes the game really produces', () => {
    for (const codigo of ['sunnywrist#9738', 'plotfiscal#9188', 'a_b-c.d#1234']) {
      assert.equal(describeFriendCode(codigo).ok, true, codigo);
    }
    // Algunas plataformas lo muestran con dos puntos.
    assert.equal(describeFriendCode('JUGADOR:1234').normalized, 'jugador#1234');
  });

  it('flags an unusual code without blocking it', () => {
    // Los 17 códigos vistos en los registros del juego tienen cuatro dígitos.
    assert.equal(looksUnusual('sunnywrist#9738'), false);
    assert.equal(looksUnusual('corto#1'), true);
    assert.equal(describeFriendCode('corto#1').ok, true, 'raro no es lo mismo que inválido');
  });

  it('refuses a registration whose friend code is not a code', () => {
    const db = database();
    const event = db.getDefaultEvent();
    assert.throws(() => inscribir(db, event.id, 'pamari', 'Pamari'),
      (error) => error.code === 'INVALID_FRIEND_CODE');
    db.close();
  });

  it('refuses two registrations sharing the same friend code', () => {
    const db = database();
    const event = db.getDefaultEvent();
    inscribir(db, event.id, 'uno', 'plotfiscal#9188');
    // Mayúsculas y dos puntos son el mismo código: el duplicado se detecta igual.
    assert.throws(() => inscribir(db, event.id, 'dos', 'PLOTFISCAL:9188'),
      (error) => error.code === 'FRIEND_CODE_TAKEN');
    db.close();
  });

  it('lets admin correct a code and keeps managing someone whose code is old and wrong', () => {
    const db = database();
    const event = db.getDefaultEvent();
    const participante = inscribir(db, event.id, 'robbie', 'sunnywrist#9739');

    // Corregir un dígito es lo que hará administración cuando el jugador avise.
    const corregido = db.updateParticipant(participante.id, { internalFriendCode: 'SUNNYWRIST#9738' });
    assert.equal(corregido.internalFriendCode, 'sunnywrist#9738', 'se guarda normalizado');

    assert.throws(() => db.updateParticipant(participante.id, { internalFriendCode: 'Robbie' }),
      (error) => error.code === 'INVALID_FRIEND_CODE');

    // Confirmar sin tocar el código no revalida: si no, un inscrito antiguo con
    // el código mal quedaría bloqueado y no se podría ni descalificar.
    const confirmado = db.updateParticipant(participante.id, { status: 'confirmed' });
    assert.equal(confirmado.status, 'confirmed');
    db.close();
  });

  it('links a reported player whatever case the code arrives in', () => {
    // El fallo latente: la inscripción se guardaba en minúsculas y la ingesta
    // buscaba con el texto tal cual llegaba.
    const db = database();
    const event = db.getDefaultEvent();
    const participante = inscribir(db, event.id, 'luis', 'coralcape#2854');
    db.updateParticipant(participante.id, { status: 'confirmed' });

    const resuelto = db.competition.resolveReportPlayerIdentities(event.id, [{ friendCode: 'CORALCAPE#2854' }]);
    assert.equal(resuelto[0].participantId, participante.id);
    assert.equal(resuelto[0].friendCode, undefined, 'nunca se devuelve el código');
    assert.equal(normalizeFriendCode('CORALCAPE#2854'), 'coralcape#2854');
    db.close();
  });
});
