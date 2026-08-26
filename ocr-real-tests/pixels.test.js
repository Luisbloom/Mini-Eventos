'use strict';

/**
 * Calibración contra los PÍXELES ORIGINALES.
 *
 * Este es el único sitio donde se abren las capturas de verdad y se les pasa
 * Tesseract. Vive fuera de `test/` a propósito: `npm test` tiene que seguir
 * siendo rápido y determinista, y esto tarda y depende del motor.
 *
 *   npm test              -> parser, fusión y rutas, con OCR falso
 *   npm run test:ocr-real -> estas dos imágenes, con el motor real
 *
 * Lo que prueban los fixtures de `test/fixtures/real-match-bind.js` es que el
 * parser entiende el **layout** de esas dos interfaces. Lo que prueba esto es
 * otra cosa: que el motor lee **esos píxeles**. Son dos preguntas distintas y
 * hacen falta las dos.
 */

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { createTesseractProvider } = require('../src/services/ocr/tesseract-provider');
const { normalizeResult } = require('../src/services/ocr');
const { classifyCapture, KINDS } = require('../src/services/captures/classify');
const { parseCapture } = require('../src/services/captures/parsers');
const { mergeCaptures } = require('../src/services/captures/merge');
const { buildPreview } = require('../src/services/captures/ingest');
const { readCapture } = require('../src/services/captures/ingest');

const CARPETA = path.join(__dirname, '..', 'test', 'fixtures', 'valorant-real');
const TRACKER = path.join(CARPETA, 'bind-tracker-scoreboard.png');
const CLIENTE = path.join(CARPETA, 'bind-client-scoreboard-es.png');

/** Los diez de la partida, repartidos como en Tracker. */
const TEAM_A = ['GreenElena', 'Hakai Shin Sella', 'tilofuro', 'Pamari18', 'Alvlp10'];
const TEAM_B = ['AlbertoYT19', 'salmongradas', 'Luisbloom', 'choripanXd343', 'MontesOnFire'];

/** Lo que Luisbloom tiene en cada fuente. */
const LUIS = Object.freeze({
  tracker: {
    acs: 213, kills: 18, deaths: 15, assists: 1, plusMinus: 3, kdRatio: 1.2,
    ddDelta: -5, adr: 129.6, hsPercent: 19, kastPercent: 78,
    firstKills: 2, firstDeaths: 3, multiKills: 1
  },
  cliente: {
    agent: 'Gekko', acs: 212, kills: 18, deaths: 15, assists: 1,
    economyRating: 57, firstKills: 2, spikesPlanted: 7, defuses: 0
  }
});

const buscar = (jugadores, nombre) => jugadores.find((jugador) =>
  (jugador.gameName || jugador.raw || '').toLowerCase().includes(nombre.toLowerCase()));

describe('calibración con los píxeles originales', () => {
  let ocr = null;
  const leido = {};

  before(async () => {
    // Si faltan, el fallo tiene que decir exactamente qué falta y dónde va.
    for (const [nombre, ruta] of [['Tracker', TRACKER], ['cliente', CLIENTE]]) {
      assert.ok(fs.existsSync(ruta),
        `Falta la captura de ${nombre}.\n  Esperada en: ${ruta}\n`
        + '  Este comando lee los PNG originales; sin ellos no hay calibración que hacer.');
    }

    ocr = createTesseractProvider();
    assert.equal(ocr.isOfflineReady(), true, 'el idioma tiene que estar en disco');

    for (const [clave, ruta] of [['tracker', TRACKER], ['cliente', CLIENTE]]) {
      const imagen = fs.readFileSync(ruta);
      leido[clave] = await readCapture(imagen, { ocrProvider: ocr, key: clave });
      leido[clave].metadata = await sharp(imagen).metadata();
    }
  });

  after(async () => { if (ocr) await ocr.close(); });

  // ================================================================ TRACKER

  describe('tracker.gg', () => {
    it('es una imagen de verdad y se lee con claridad', (contexto) => {
      const { metadata, confidence, ocr: texto } = leido.tracker;
      assert.ok(metadata.width >= 800, `ancho inesperado: ${metadata.width}`);
      assert.ok(texto.words.length > 100, `pocas palabras: ${texto.words.length}`);
      assert.ok(confidence > 0.6, `confianza baja: ${confidence}`);
      contexto.diagnostic(
        `${metadata.width}x${metadata.height} · ${texto.words.length} palabras · `
        + `confianza ${(confidence * 100).toFixed(1)}`);
    });

    it('se clasifica por su estructura, no por la marca', () => {
      assert.equal(leido.tracker.sourceKind, KINDS.TRACKER_MATCH);
    });

    it('saca el mapa y el marcador orientado', () => {
      const { parsed } = leido.tracker;
      assert.equal(parsed.map?.key, 'bind', `mapa leído: ${JSON.stringify(parsed.map)}`);
      assert.equal(parsed.teamARounds, 13);
      assert.equal(parsed.teamBRounds, 10);
    });

    it('encuentra exactamente diez jugadores, cinco por lado', (contexto) => {
      const { players } = leido.tracker.parsed;
      contexto.diagnostic(`filas: ${players.map((j) => j.gameName).join(' | ')}`);

      assert.equal(players.length, 10,
        `esperaba 10 filas y hay ${players.length}: ${players.map((j) => j.raw).join(' / ')}`);
      assert.equal(players.filter((j) => j.visualTeam === 'A').length, 5);
      assert.equal(players.filter((j) => j.visualTeam === 'B').length, 5);
    });

    it('reconoce a los diez por su nombre', () => {
      const { players } = leido.tracker.parsed;
      for (const nombre of [...TEAM_A, ...TEAM_B]) {
        assert.ok(buscar(players, nombre.split(' ')[0]),
          `no aparece ${nombre}: ${players.map((j) => j.gameName).join(', ')}`);
      }
    });

    it('los equipos salen separados como en la captura', () => {
      const { players } = leido.tracker.parsed;
      const lado = (nombre) => buscar(players, nombre.split(' ')[0])?.visualTeam;
      for (const nombre of TEAM_A) assert.equal(lado(nombre), 'A', nombre);
      for (const nombre of TEAM_B) assert.equal(lado(nombre), 'B', nombre);
    });

    it('lee la fila de Luisbloom entera', (contexto) => {
      const luis = buscar(leido.tracker.parsed.players, 'Luisbloom');
      assert.ok(luis, 'Luisbloom no aparece en la tabla de Tracker');
      contexto.diagnostic(`Luisbloom: ${JSON.stringify(luis)}`);

      for (const [campo, esperado] of Object.entries(LUIS.tracker)) {
        assert.equal(luis[campo], esperado, `${campo}: ${luis[campo]} en vez de ${esperado}`);
      }
    });

    it('las etiquetas que se lean son correctas', (contexto) => {
      // Son diminutas y grises: no se exige leerlas todas, pero la que salga
      // tiene que ser la buena. Una etiqueta inventada es peor que ninguna.
      const conTag = leido.tracker.parsed.players.filter((j) => j.tagLine);
      contexto.diagnostic(`etiquetas leídas: ${conTag.length}/10 · `
        + conTag.map((j) => j.riotId).join(' '));

      const esperadas = {
        GreenElena: '1409', 'Hakai Shin Sella': '1306', tilofuro: '1740',
        Pamari18: 'EUW', Alvlp10: 'Arsa', AlbertoYT19: '9047',
        salmongradas: 'Vox', Luisbloom: 'NANO', choripanXd343: '1206', MontesOnFire: 'EUW'
      };
      for (const jugador of conTag) {
        const nombre = Object.keys(esperadas).find((n) =>
          n.toLowerCase().startsWith(jugador.gameName.toLowerCase().split(' ')[0]));
        if (!nombre) continue;
        assert.equal(jugador.tagLine, esperadas[nombre],
          `etiqueta mal leída para ${jugador.gameName}`);
      }
    });
  });

  // ================================================================ CLIENTE

  describe('cliente de Valorant, en español', () => {
    it('es una imagen de verdad y se lee con claridad', (contexto) => {
      const { metadata, confidence, ocr: texto } = leido.cliente;
      assert.ok(metadata.width >= 1200, `ancho inesperado: ${metadata.width}`);
      assert.ok(texto.words.length > 60, `pocas palabras: ${texto.words.length}`);
      assert.ok(confidence > 0.6, `confianza baja: ${confidence}`);
      contexto.diagnostic(
        `${metadata.width}x${metadata.height} · ${texto.words.length} palabras · `
        + `confianza ${(confidence * 100).toFixed(1)}`);
    });

    it('se clasifica por sus cabeceras en español', () => {
      assert.equal(leido.cliente.sourceKind, KINDS.VALORANT_SCOREBOARD);
    });

    it('el marcador viene sin orientar, y no se inventa el mapa', () => {
      const { parsed } = leido.cliente;
      assert.deepEqual([...parsed.scorePair].sort((a, b) => a - b), [10, 13]);
      assert.equal(parsed.teamARounds, null, 'esta pantalla no dice de quién es cada cifra');
      assert.equal(parsed.map, null, 'esta pantalla no enseña el mapa');
    });

    it('encuentra exactamente diez jugadores', (contexto) => {
      const { players } = leido.cliente.parsed;
      contexto.diagnostic(`filas: ${players.map((j) => j.gameName).join(' | ')}`);
      assert.equal(players.length, 10,
        `esperaba 10 filas y hay ${players.length}: ${players.map((j) => j.raw).join(' / ')}`);
    });

    it('junta el agente del renglón de debajo', (contexto) => {
      const { players } = leido.cliente.parsed;
      const conAgente = players.filter((j) => j.agent);
      contexto.diagnostic(`agentes: ${players.map((j) => `${j.gameName}=${j.agent}`).join(' ')}`);
      assert.ok(conAgente.length >= 8,
        `sólo ${conAgente.length} agentes de 10`);
    });

    it('lee la fila de Luisbloom entera', (contexto) => {
      const luis = buscar(leido.cliente.parsed.players, 'Luisbloom');
      assert.ok(luis, 'Luisbloom no aparece en la tabla del cliente');
      contexto.diagnostic(`Luisbloom: ${JSON.stringify(luis)}`);

      for (const [campo, esperado] of Object.entries(LUIS.cliente)) {
        assert.equal(luis[campo], esperado, `${campo}: ${luis[campo]} en vez de ${esperado}`);
      }
    });
  });

  // ================================================================== FUSIÓN

  describe('las dos, fusionadas', () => {
    const fusionar = () => mergeCaptures([
      { captureId: 1, kind: leido.tracker.sourceKind, parsed: leido.tracker.parsed },
      { captureId: 2, kind: leido.cliente.sourceKind, parsed: leido.cliente.parsed }
    ]);

    it('sale Bind, 13-10 y diez jugadores únicos', (contexto) => {
      const fusion = fusionar();
      contexto.diagnostic(`jugadores: ${fusion.players.map((j) => j.gameName).join(' | ')}`);

      assert.equal(fusion.map, 'bind');
      assert.equal(fusion.teamARounds, 13);
      assert.equal(fusion.teamBRounds, 10);
      assert.equal(fusion.score.corroborated, true,
        'el par del cliente tiene que corroborar el de Tracker');
      assert.equal(fusion.players.length, 10,
        'la misma persona no puede contarse dos veces por llevar etiqueta en una sola captura');
    });

    it('sin conflictos duros, y las diferencias de redondeo anotadas', (contexto) => {
      const fusion = fusionar();
      contexto.diagnostic(`conflictos: ${JSON.stringify(fusion.conflicts)}`);
      contexto.diagnostic(`variaciones: ${fusion.variances.length} · `
        + fusion.variances.map((v) => `${v.player}.${v.field}`).join(' '));

      assert.deepEqual(fusion.conflicts, [], 'no debería haber ningún conflicto duro');
      assert.ok(fusion.variances.length > 0,
        'el ACS difiere en 1 en varios: tiene que quedar anotado');
      assert.equal(fusion.variances.every((v) => v.code === 'ROUNDING_VARIANCE'), true);
    });

    it('Luisbloom queda con lo que aporta cada fuente', (contexto) => {
      const luis = buscar(fusionar().players, 'Luisbloom');
      contexto.diagnostic(`fusionado: ${JSON.stringify(luis)}`);

      assert.deepEqual({
        agent: luis.agent, acs: luis.acs,
        kills: luis.kills, deaths: luis.deaths, assists: luis.assists,
        plusMinus: luis.plusMinus, kdRatio: luis.kdRatio, ddDelta: luis.ddDelta,
        adr: luis.adr, hsPercent: luis.hsPercent, kastPercent: luis.kastPercent,
        firstKills: luis.firstKills, firstDeaths: luis.firstDeaths, multiKills: luis.multiKills,
        economyRating: luis.economyRating, spikesPlanted: luis.spikesPlanted, defuses: luis.defuses
      }, {
        agent: 'Gekko', acs: 212,
        kills: 18, deaths: 15, assists: 1,
        plusMinus: 3, kdRatio: 1.2, ddDelta: -5,
        adr: 129.6, hsPercent: 19, kastPercent: 78,
        firstKills: 2, firstDeaths: 3, multiKills: 1,
        economyRating: 57, spikesPlanted: 7, defuses: 0
      });
    });

    it('el ACS canónico es el del cliente, y se guarda el de Tracker', () => {
      const luis = buscar(fusionar().players, 'Luisbloom');
      assert.equal(luis.acs, 212, 'manda el cliente: es el dato de primera mano');

      const observaciones = luis.observations?.acs ?? [];
      assert.equal(observaciones.find((o) => o.source === 'VALORANT')?.value, 212);
      assert.equal(observaciones.find((o) => o.source === 'TRACKER')?.value, 213,
        'lo que decía Tracker no se pierde');
    });
  });

  // ============================================================ CON ROSTER

  describe('previsualización con los equipos del torneo', () => {
    /** Los diez inscritos, en dos equipos del torneo. */
    const roster = [
      ...TEAM_A.map((nombre, i) => ({
        participantId: 100 + i, teamId: 27, teamName: 'Ganadores',
        displayName: nombre, riotId: null
      })),
      ...TEAM_B.map((nombre, i) => ({
        participantId: 200 + i, teamId: 31, teamName: 'Perdedores',
        displayName: nombre, riotId: null
      }))
    ];

    const lecturas = () => [
      { captureId: 1, sourceKind: leido.tracker.sourceKind, parsed: leido.tracker.parsed, confidence: leido.tracker.confidence },
      { captureId: 2, sourceKind: leido.cliente.sourceKind, parsed: leido.cliente.parsed, confidence: leido.cliente.confidence }
    ];

    it('queda lista para importar, sin revisión', (contexto) => {
      const preview = buildPreview(lecturas(), {
        roster, expectedMap: 'bind', teamAId: 27, teamBId: 31
      });
      contexto.diagnostic(`avisos: ${JSON.stringify(preview.issues)}`);
      contexto.diagnostic(`notas: ${preview.notes.length}`);

      assert.equal(preview.status, 'READY',
        `esperaba READY: ${JSON.stringify(preview.issues)}`);
      assert.equal(preview.map, 'bind');
      assert.equal(preview.teamARounds, 13);
      assert.equal(preview.teamBRounds, 10);
      assert.equal(preview.players.length, 10);
      assert.equal(preview.players.every((j) => j.participantId), true,
        'los diez tienen que quedar asociados');
    });

    it('el marcador se orienta por el roster, no por la posición en la imagen', () => {
      // Los mismos equipos, pero al revés en la serie del torneo.
      const alReves = roster.map((persona) => ({
        ...persona, teamId: persona.teamId === 27 ? 31 : 27
      }));
      const preview = buildPreview(lecturas(), {
        roster: alReves, expectedMap: 'bind', teamAId: 27, teamBId: 31
      });

      assert.equal(preview.status, 'READY', JSON.stringify(preview.issues));
      assert.equal(preview.orientation.swapped, true);
      assert.equal(preview.teamARounds, 10, 'el 13 va a quien de verdad ganó');
      assert.equal(preview.teamBRounds, 13);
    });
  });

  // ================================================================ RESIZE

  describe('a otra resolución', () => {
    /**
     * La misma captura reescalada tiene que leerse igual. Si algo depende de
     * una coordenada concreta, aquí se cae: los umbrales van en proporción al
     * ancho, no en píxeles.
     */
    for (const escala of [0.75, 1.25]) {
      it(`al ${Math.round(escala * 100)}% sigue saliendo lo mismo`, async (contexto) => {
        const redimensionar = async (ruta) => {
          const { width } = await sharp(ruta).metadata();
          return sharp(ruta).resize({ width: Math.round(width * escala) }).png().toBuffer();
        };

        const t = await readCapture(await redimensionar(TRACKER), { ocrProvider: ocr, key: `t${escala}` });
        const c = await readCapture(await redimensionar(CLIENTE), { ocrProvider: ocr, key: `c${escala}` });

        contexto.diagnostic(
          `tracker: ${t.parsed.players.length} filas · cliente: ${c.parsed.players.length} filas`);

        assert.equal(t.sourceKind, KINDS.TRACKER_MATCH);
        assert.equal(t.parsed.map?.key, 'bind');
        assert.equal(t.parsed.teamARounds, 13);
        assert.equal(t.parsed.teamBRounds, 10);
        assert.equal(t.parsed.players.length, 10);

        assert.equal(c.sourceKind, KINDS.VALORANT_SCOREBOARD);
        assert.deepEqual([...c.parsed.scorePair].sort((a, b) => a - b), [10, 13]);
        assert.equal(c.parsed.players.length, 10);
        // Las etiquetas pueden perderse al reescalar y no es un fallo.
      });
    }
  });
});
