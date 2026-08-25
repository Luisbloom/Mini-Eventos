'use strict';

/**
 * El único test que arranca Tesseract de verdad.
 *
 * Todo lo demás usa el OCR falso: lo que hay que probar es el parser, la fusión
 * y la confirmación, y hacerlo depender de que un motor acierte convierte cada
 * ejecución en una tirada de dados. Pero si NADA usa el motor real, el día que
 * deje de cargarse nos enteramos en el torneo.
 *
 * Así que aquí se comprueba una vez lo que sólo el motor real puede demostrar:
 * que arranca sin Internet y que la cadena imagen → texto → parser encaja.
 */

const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTesseractProvider, isOfflineReady, trainedDataPath } = require('../src/services/ocr/tesseract-provider');
const { normalizeResult } = require('../src/services/ocr');
const { classifyCapture, KINDS } = require('../src/services/captures/classify');
const { parseCapture } = require('../src/services/captures/parsers');
const { preprocess } = require('../src/services/captures/ingest');
const { renderScreenshot, renderWords, postMatchLines } = require('./helpers/fake-screenshot');
const { mergeCaptures } = require('../src/services/captures/merge');
const F = require('./fixtures/real-match-bind');

describe('OCR real', () => {
  let provider = null;
  after(async () => { if (provider) await provider.close(); });

  it('puede leer sin Internet', () => {
    // Tesseract.js se baja el idioma de un CDN si no lo encuentra en disco. El
    // día del torneo eso sería una dependencia de red en el peor momento.
    assert.equal(isOfflineReady('eng'), true,
      `falta el idioma en ${trainedDataPath('eng')}`);
  });

  it('lee una captura sintética de punta a punta', async (contexto) => {
    // Arrancar el motor y reconocer tarda unos segundos: por eso este test es
    // uno solo y todos los demás usan el proveedor falso.
    contexto.diagnostic('arrancando Tesseract, esto tarda unos segundos');

    const lineas = postMatchLines();
    const imagen = await renderScreenshot(lineas);

    provider = createTesseractProvider();
    const bruto = await provider.recognize(await preprocess(imagen));
    const ocr = normalizeResult(bruto);

    assert.ok(ocr.words.length > 40, `pocas palabras leídas: ${ocr.words.length}`);
    assert.ok(ocr.confidence > 70, `confianza baja: ${ocr.confidence}`);

    // Cada palabra viene con su caja: sin eso el parser no puede saber qué
    // número pertenece a qué columna.
    for (const palabra of ocr.words.slice(0, 20)) {
      assert.ok(palabra.bbox.x1 > palabra.bbox.x0, 'la caja tiene ancho');
      assert.ok(palabra.bbox.y1 > palabra.bbox.y0, 'la caja tiene alto');
    }
    assert.ok(ocr.lines.length >= 10, `pocas líneas agrupadas: ${ocr.lines.length}`);

    const tipo = classifyCapture(ocr);
    assert.equal(tipo.kind, KINDS.VALORANT_POST_MATCH);

    const leido = parseCapture(tipo.kind, ocr);
    assert.equal(leido.map?.key, 'ascent', `mapa leído: ${JSON.stringify(leido.map)}`);
    assert.equal(leido.teamARounds, 13);
    assert.equal(leido.teamBRounds, 8);
    assert.equal(leido.players.length, 10, `jugadores leídos: ${leido.players.length}`);

    // Los Riot ID llevan almohadilla: si el OCR se la come, no hay forma de
    // reconocer a nadie.
    const conRiotId = leido.players.filter((jugador) => jugador.riotId);
    assert.ok(conRiotId.length >= 8,
      `sólo ${conRiotId.length} Riot ID legibles: ${leido.players.map((j) => j.raw).join(', ')}`);

    const primero = leido.players[0];
    assert.equal(primero.kills, 24, `fila leída: ${JSON.stringify(primero)}`);
    assert.equal(primero.deaths, 16);
    assert.equal(primero.acs, 287);

    contexto.diagnostic(
      `leídas ${ocr.words.length} palabras, confianza ${ocr.confidence.toFixed(1)}`);
  });

  /**
   * Los dos layouts reales, dibujados en sus coordenadas y pasados por el motor
   * de verdad.
   *
   * ⚠️ Esto NO es la calibración con las capturas originales: es la misma
   * disposición, no los mismos píxeles. Lo que demuestra es que la cadena
   * imagen -> Tesseract -> columnas -> fusión aguanta las dos interfaces, con
   * sus cabeceras en español, su celda agrupada y sus etiquetas pequeñas.
   */
  it('lee las dos pantallas reales y las fusiona', async (contexto) => {
    contexto.diagnostic('dos imágenes por el motor real: tarda unos segundos');
    if (!provider) provider = createTesseractProvider();

    const leer = async (words) => {
      const png = await renderWords(words);
      const ocr = normalizeResult(await provider.recognize(await preprocess(png)));
      const tipo = classifyCapture(ocr);
      return { ocr, kind: tipo.kind, parsed: parseCapture(tipo.kind, ocr) };
    };

    const tracker = await leer(F.trackerWords());
    const cliente = await leer(F.clientWords());

    assert.equal(tracker.kind, KINDS.TRACKER_MATCH);
    assert.equal(cliente.kind, KINDS.VALORANT_SCOREBOARD);

    // Tracker: mapa, marcador orientado y los dos equipos separados.
    assert.equal(tracker.parsed.map?.key, 'bind');
    assert.equal(tracker.parsed.teamARounds, 13);
    assert.equal(tracker.parsed.teamBRounds, 10);
    assert.equal(tracker.parsed.players.length, 10);
    assert.equal(tracker.parsed.players.filter((j) => j.visualTeam === 'A').length, 5);

    // El cliente: sin mapa, marcador sin orientar y los agentes.
    assert.equal(cliente.parsed.map, null, 'esa pantalla no enseña el mapa');
    assert.deepEqual(cliente.parsed.scorePair, [10, 13]);
    assert.equal(cliente.parsed.players.length, 10);

    const fusion = mergeCaptures([
      { captureId: 1, kind: tracker.kind, parsed: tracker.parsed },
      { captureId: 2, kind: cliente.kind, parsed: cliente.parsed }
    ]);

    assert.equal(fusion.map, 'bind');
    assert.equal(fusion.teamARounds, 13);
    assert.equal(fusion.teamBRounds, 10);
    assert.equal(fusion.score.corroborated, true, 'las dos dicen el mismo par');
    assert.equal(fusion.players.length, 10, 'nadie duplicado entre las dos');

    // Un jugador que aparece en las dos, con lo que aporta cada una.
    const elena = fusion.players.find((j) => (j.gameName || '').includes('GreenElena'));
    assert.equal(elena.riotId, 'GreenElena#1409', 'la etiqueta pequeña se lee');
    assert.equal(elena.agent, 'Cypher', 'el agente sale del cliente');
    assert.equal(elena.adr, 248.8, 'el ADR sale de Tracker');
    assert.equal(elena.kills, 28);
    assert.equal(elena.deaths, 9);
    assert.equal(elena.assists, 7);
    assert.equal(elena.economyRating, 116, 'la economía sale del cliente');

    contexto.diagnostic(
      `fusionadas: ${fusion.players.length} jugadores, ${fusion.conflicts.length} conflictos, `
      + `${fusion.variances.length} diferencias de redondeo`);
  });
});
