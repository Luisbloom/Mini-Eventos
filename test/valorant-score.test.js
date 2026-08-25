'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateValorantScore, DEFAULT_SCORE_POLICY } = require('../src/services/valorant-score');

describe('marcador de Valorant', () => {
  const vale = (a, b, policy) => validateValorantScore(a, b, policy);

  describe('resultados reglamentarios', () => {
    it('acepta un 13-X con X hasta 11', () => {
      for (let perdidas = 0; perdidas <= 11; perdidas++) {
        const r = vale(13, perdidas);
        assert.equal(r.ok, true, `13-${perdidas} debería valer`);
        assert.equal(r.winner, 'a');
        assert.equal(r.overtime, false);
      }
    });

    it('el ganador sale del marcador, no de quien pregunta', () => {
      assert.equal(vale(13, 4).winner, 'a');
      assert.equal(vale(4, 13).winner, 'b');
    });
  });

  describe('prórroga', () => {
    it('acepta ganar por dos desde el empate a doce', () => {
      for (const [a, b] of [[14, 12], [15, 13], [16, 14], [20, 18]]) {
        const r = vale(a, b);
        assert.equal(r.ok, true, `${a}-${b} debería valer`);
        assert.equal(r.overtime, true);
      }
    });

    it('rechaza ganar por una sola ronda', () => {
      for (const [a, b] of [[14, 13], [15, 14], [16, 15]]) {
        const r = vale(a, b);
        assert.equal(r.ok, false, `${a}-${b} no cierra la partida`);
        assert.equal(r.code, 'SCORE_INVALID');
      }
    });

    it('rechaza diferencias de tres o más pasadas las trece', () => {
      // No se puede llegar a 15-11: la partida habría acabado en 13-11.
      for (const [a, b] of [[15, 11], [16, 12], [14, 5]]) {
        assert.equal(vale(a, b).ok, false, `${a}-${b} no es alcanzable`);
      }
    });

    it('con una política sin prórroga sólo vale trece', () => {
      const sinProrroga = { ...DEFAULT_SCORE_POLICY, overtime: false };
      assert.equal(vale(13, 11, sinProrroga).ok, true);
      const r = vale(14, 12, sinProrroga);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SCORE_INVALID');
    });

    it('otra política cambia la meta sin tocar el código', () => {
      // Por si el torneo juega alguna vez a primero de 9.
      const corta = { ...DEFAULT_SCORE_POLICY, roundsToWin: 9 };
      assert.equal(vale(9, 7, corta).ok, true);
      assert.equal(vale(10, 8, corta).ok, true);
      // 13-11 con meta 9 sí vale: son prórrogas encadenadas desde el 8-8.
      assert.equal(vale(13, 11, corta).ok, true);
      assert.equal(vale(9, 8, corta).ok, false, 'con meta 9, un 9-8 sería prórroga sin cerrar');
    });
  });

  describe('lo que no es un marcador de Valorant', () => {
    it('rechaza partidas a medias', () => {
      for (const [a, b] of [[3, 1], [12, 10], [0, 0], [8, 2], [12, 11]]) {
        const r = vale(a, b);
        assert.equal(r.ok, false, `${a}-${b} no es una partida terminada`);
      }
      assert.equal(vale(3, 1).code, 'SCORE_INCOMPLETE');
      assert.equal(vale(12, 10).code, 'SCORE_INCOMPLETE');
    });

    it('rechaza el empate', () => {
      for (const [a, b] of [[13, 13], [12, 12], [0, 0], [15, 15]]) {
        const r = vale(a, b);
        assert.equal(r.ok, false);
        assert.equal(r.code, 'SCORE_TIE', `${a}-${b}`);
      }
    });

    it('rechaza negativos, decimales y texto', () => {
      for (const malo of [[-1, 13], [13, -4], [13.5, 2], ['muchas', 3], [13, 'pocas'],
        [null, 13], [undefined, 13], ['', 13], [NaN, 13], [true, 13], [Infinity, 2]]) {
        const r = vale(malo[0], malo[1]);
        assert.equal(r.ok, false, JSON.stringify(malo));
        assert.equal(r.code, 'INVALID_ROUNDS', JSON.stringify(malo));
      }
    });

    it('rechaza cifras absurdas', () => {
      const r = vale(400, 398);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'INVALID_ROUNDS');
    });

    it('las cadenas numéricas sí valen: vienen de un formulario', () => {
      const r = vale('13', '7');
      assert.equal(r.ok, true);
      assert.equal(r.winner, 'a');
    });
  });

  it('todo fallo trae código y mensaje explicable', () => {
    for (const [a, b] of [[3, 1], [13, 13], [-1, 5], [14, 13]]) {
      const r = vale(a, b);
      assert.equal(r.ok, false);
      assert.equal(typeof r.code, 'string');
      assert.ok(r.message.length > 10, `mensaje pobre para ${a}-${b}: ${r.message}`);
    }
  });
});
