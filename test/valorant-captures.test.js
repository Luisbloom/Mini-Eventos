'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { createFakeProvider } = require('../src/services/ocr/fake-provider');
const { normalizeResult } = require('../src/services/ocr');
const { classifyCapture, KINDS } = require('../src/services/captures/classify');
const { parseCapture } = require('../src/services/captures/parsers');
const { mergeCaptures } = require('../src/services/captures/merge');
const { matchPlayer, matchRoster, MATCH } = require('../src/services/captures/match-players');
const { inspectImage, sniffFormat } = require('../src/services/captures/storage');
const { renderScreenshot, postMatchLines, PARTIDA_DE_MUESTRA } = require('./helpers/fake-screenshot');

const ADMIN = 'token-de-pruebas';

// ---------------------------------------------------------------- fixtures OCR

/** Una captura de Valorant: mapa, marcador, K/D/A y ACS. */
const VALORANT_TEXTO = postMatchLines().join('\n');

/** Una de Tracker del mismo partido: además trae ADR, HS% y KAST. */
function trackerTexto(partida = PARTIDA_DE_MUESTRA, cambios = {}) {
  const col = (valor, ancho) => String(valor).padEnd(ancho);
  const rondasA = cambios.teamARounds ?? partida.teamA.rounds;
  const rondasB = cambios.teamBRounds ?? partida.teamB.rounds;
  const mapa = cambios.map ?? partida.map;

  return [
    'TRACKER.GG MATCH DETAILS',
    `${mapa}   COMPETITIVE`,
    `${partida.teamA.name} ${rondasA} - ${rondasB} ${partida.teamB.name}`,
    '',
    `${col('PLAYER', 20)}${col('ACS', 6)}${col('K', 5)}${col('D', 5)}${col('A', 5)}${col('ADR', 6)}${col('HS%', 6)}KAST`,
    ...partida.players.map((jugador, indice) =>
      `${col(jugador.name, 20)}${col(jugador.acs, 6)}${col(jugador.k, 5)}${col(jugador.d, 5)}`
      + `${col(jugador.a, 5)}${col(120 + indice * 7, 6)}${col(20 + indice * 2, 6)}${65 + indice}`)
  ].join('\n');
}

function leer(texto) {
  const provider = createFakeProvider(texto);
  return provider.recognize(null).then((bruto) => {
    const ocr = normalizeResult(bruto);
    const tipo = classifyCapture(ocr);
    return { ocr, tipo, parsed: parseCapture(tipo.kind, ocr) };
  });
}

// =============================================================== PARSER

describe('lectura de capturas', () => {
  describe('clasificación', () => {
    it('distingue Valorant de Tracker', async () => {
      assert.equal((await leer(VALORANT_TEXTO)).tipo.kind, KINDS.VALORANT_POST_MATCH);
      assert.equal((await leer(trackerTexto())).tipo.kind, KINDS.TRACKER_MATCH);
    });

    it('lo que no reconoce lo dice, en vez de adivinar', async () => {
      for (const texto of ['', 'hola qué tal', 'FACTURA 2026 IVA 21%', 'lorem ipsum dolor']) {
        const { tipo } = await leer(texto);
        assert.equal(tipo.kind, KINDS.UNKNOWN, JSON.stringify(texto));
      }
    });

    it('no se fía del nombre del archivo', async () => {
      // El texto manda: da igual cómo se llame la imagen.
      const { tipo } = await leer('valorant-scoreboard-ascent.png');
      assert.equal(tipo.kind, KINDS.UNKNOWN);
    });

    it('un UNKNOWN no inventa datos', () => {
      const vacio = parseCapture(KINDS.UNKNOWN, { text: '', lines: [], words: [] });
      assert.equal(vacio.map, null);
      assert.equal(vacio.teamARounds, null);
      assert.equal(vacio.teamBRounds, null);
      assert.deepEqual(vacio.players, []);
    });
  });

  describe('datos del partido', () => {
    it('saca mapa, marcador y las diez filas', async () => {
      const { parsed } = await leer(VALORANT_TEXTO);
      assert.deepEqual(parsed.map, { key: 'ascent', name: 'Ascent' });
      assert.equal(parsed.teamARounds, 13);
      assert.equal(parsed.teamBRounds, 8);
      assert.equal(parsed.players.length, 10);
    });

    it('cada fila trae su Riot ID, agente y estadísticas', async () => {
      const { parsed } = await leer(VALORANT_TEXTO);
      const primero = parsed.players[0];
      assert.equal(primero.riotId, 'Sella#NANO');
      assert.equal(primero.gameName, 'Sella');
      assert.equal(primero.tagLine, 'NANO');
      assert.equal(primero.agent, 'Raze');
      assert.equal(primero.acs, 287);
      assert.equal(primero.kills, 24);
      assert.equal(primero.deaths, 16);
      assert.equal(primero.assists, 5);
    });

    it('lo que no está visible queda en null, nunca en cero', async () => {
      const { parsed } = await leer(VALORANT_TEXTO);
      for (const jugador of parsed.players) {
        // Esta captura no trae esas columnas: no pueden salir como 0.
        assert.notEqual(jugador.adr, 0, `${jugador.riotId} no debería tener ADR 0`);
        assert.ok(jugador.adr === undefined || jugador.adr === null);
        assert.ok(jugador.kastPercent === undefined || jugador.kastPercent === null);
      }
    });

    it('la captura de Tracker sí trae las columnas extra', async () => {
      const { parsed } = await leer(trackerTexto());
      assert.equal(parsed.players.length, 10);
      const primero = parsed.players[0];
      assert.equal(primero.adr, 120);
      assert.equal(primero.hsPercent, 20);
      assert.equal(primero.kastPercent, 65);
    });

    it('lee las columnas por posición, no por orden fijo', async () => {
      // Mismo partido con las columnas al revés: debe leerse igual.
      const alReves = [
        'VALORANT COMPETITIVE',
        'HAVEN',
        'ALFA  13',
        'BETA  6',
        '',
        'PLAYER              A     D     K     ACS',
        'Uno#AAA             5     16    24    287',
        'Dos#BBB             3     17    20    241'
      ].join('\n');
      const { parsed } = await leer(alReves);
      assert.equal(parsed.map.key, 'haven');
      assert.equal(parsed.players[0].kills, 24);
      assert.equal(parsed.players[0].deaths, 16);
      assert.equal(parsed.players[0].assists, 5);
      assert.equal(parsed.players[0].acs, 287);
    });

    it('no confunde el mapa con una palabra que lo contenga', async () => {
      const { parsed } = await leer([
        'VALORANT COMPETITIVE', 'BINDING OF ISAAC', 'ALFA 13', 'BETA 4',
        '', 'PLAYER AGENT ACS K D A', 'Uno#AAA Raze 200 13 4 2'
      ].join('\n'));
      assert.equal(parsed.map, null, 'BINDING no es Bind');
    });
  });
});

// =============================================================== FUSIÓN

describe('fusión de varias capturas', () => {
  async function dos(cambiosTracker = {}) {
    const valorant = await leer(VALORANT_TEXTO);
    const tracker = await leer(trackerTexto(PARTIDA_DE_MUESTRA, cambiosTracker));
    return mergeCaptures([
      { captureId: 1, kind: valorant.tipo.kind, parsed: valorant.parsed },
      { captureId: 2, kind: tracker.tipo.kind, parsed: tracker.parsed }
    ]);
  }

  it('junta lo que aporta cada una', async () => {
    const fusion = await dos();
    assert.equal(fusion.conflicts.length, 0, 'no debería haber conflictos');
    assert.equal(fusion.map, 'ascent');
    assert.equal(fusion.teamARounds, 13);
    assert.equal(fusion.teamBRounds, 8);
    assert.equal(fusion.players.length, 10, 'la misma persona no se duplica');

    const sella = fusion.players.find((jugador) => jugador.riotId === 'Sella#NANO');
    assert.equal(sella.kills, 24, 'de la captura de Valorant');
    assert.equal(sella.acs, 287);
    assert.equal(sella.adr, 120, 'de la de Tracker');
    assert.equal(sella.hsPercent, 20);
    assert.equal(sella.kastPercent, 65);
    assert.equal(sella.agent, 'Raze', 'el agente sólo lo traía una');
    assert.deepEqual(sella.seenIn, [1, 2]);
  });

  it('un marcador distinto es un conflicto, no una votación', async () => {
    const fusion = await dos({ teamBRounds: 9 });
    const conflicto = fusion.conflicts.find((c) => c.field === 'teamBRounds' || c.field === 'score');
    assert.ok(conflicto, `el marcador discrepante tiene que salir: ${JSON.stringify(fusion.conflicts)}`);
    // Ahora se dice QUÉ fuente decía cada cosa, no sólo qué imagen.
    assert.ok(conflicto.sources.includes('TRACKER') || conflicto.sources.includes('VALORANT'));
  });

  it('un mapa distinto también', async () => {
    const fusion = await dos({ map: 'HAVEN' });
    const conflicto = fusion.conflicts.find((c) => c.field === 'map');
    assert.ok(conflicto);
    assert.deepEqual(conflicto.values.sort(), ['ascent', 'haven']);
  });

  it('una estadística distinta del mismo jugador se marca', async () => {
    const partida = JSON.parse(JSON.stringify(PARTIDA_DE_MUESTRA));
    partida.players[0].k = 25;                       // Tracker dice otra cosa
    const valorant = await leer(VALORANT_TEXTO);
    const tracker = await leer(trackerTexto(partida));
    const fusion = mergeCaptures([
      { captureId: 1, kind: valorant.tipo.kind, parsed: valorant.parsed },
      { captureId: 2, kind: tracker.tipo.kind, parsed: tracker.parsed }
    ]);
    const conflicto = fusion.conflicts.find((c) => c.field.includes('kills'));
    assert.ok(conflicto, `esperaba conflicto de kills, hubo: ${fusion.conflicts.map((c) => c.field)}`);
    assert.deepEqual(conflicto.values.sort(), [24, 25]);
  });

  it('un dato que falta en las dos sigue faltando', async () => {
    const solaValorant = await leer(VALORANT_TEXTO);
    const fusion = mergeCaptures([
      { captureId: 1, kind: solaValorant.tipo.kind, parsed: solaValorant.parsed }
    ]);
    for (const jugador of fusion.players) {
      assert.equal(jugador.adr, null, 'ausente es null, no cero');
      assert.equal(jugador.kastPercent, null);
    }
    assert.equal(fusion.conflicts.length, 0, 'faltar no es discrepar');
  });
});

// =============================================================== JUGADORES

describe('asociación de jugadores', () => {
  const roster = [
    { participantId: 1, teamId: 10, displayName: 'Sella', riotId: 'Sella#NANO' },
    { participantId: 2, teamId: 10, displayName: 'Luisbloom', riotId: 'Luisbloom#NANO' },
    { participantId: 3, teamId: 10, displayName: 'Chuche', riotId: 'chuche#JART' },
    { participantId: 4, teamId: 20, displayName: 'Nano', riotId: 'Nano#EUW' },
    { participantId: 5, teamId: 20, displayName: 'Bruma', riotId: 'Bruma#ESP' }
  ];

  it('el Riot ID completo manda', () => {
    const r = matchPlayer({ riotId: 'Sella#NANO', gameName: 'Sella' }, roster);
    assert.equal(r.match, MATCH.RIOT_ID);
    assert.equal(r.participantId, 1);
    assert.equal(r.confidence, 1);
  });

  it('el nombre exacto vale cuando no hay tag', () => {
    const r = matchPlayer({ gameName: 'Luisbloom', raw: 'Luisbloom' }, roster);
    assert.equal(r.match, MATCH.GAME_NAME);
    assert.equal(r.participantId, 2);
  });

  it('el parecido sugiere pero no asigna a ciegas', () => {
    // Un OCR que se come una letra.
    const r = matchPlayer({ gameName: 'Luisbioom', raw: 'Luisbioom' }, roster);
    assert.equal(r.match, MATCH.FUZZY);
    assert.equal(r.participantId, 2);
    assert.ok(r.confidence > 0.8 && r.confidence < 1, `confianza rara: ${r.confidence}`);
  });

  it('con dos candidatos parecidos no elige', () => {
    const gemelos = [
      { participantId: 7, teamId: 10, displayName: 'Marcos', riotId: 'Marcos1#EU' },
      { participantId: 8, teamId: 20, displayName: 'Marcos', riotId: 'Marcos2#EU' }
    ];
    const r = matchPlayer({ gameName: 'Marcos', raw: 'Marcos' }, gemelos);
    assert.equal(r.match, MATCH.AMBIGUOUS);
    assert.equal(r.participantId, null);
    assert.equal(r.candidates.length, 2);
  });

  it('a quien no juega este partido no lo encuentra', () => {
    const r = matchPlayer({ gameName: 'Zorro', raw: 'Zorro' }, roster);
    assert.equal(r.match, MATCH.NONE);
    assert.equal(r.participantId, null);
  });

  it('nadie sale dos veces, y el Riot ID gana al parecido', () => {
    // "Selia" se parece a Sella, pero Sella aparece más abajo con su Riot ID
    // entero: ese sitio es suyo.
    const asociados = matchRoster([
      { gameName: 'Selia', raw: 'Selia' },
      { riotId: 'Sella#NANO', gameName: 'Sella', raw: 'Sella#NANO' }
    ], roster);

    assert.equal(asociados[1].participantId, 1, 'el Riot ID exacto se queda con Sella');
    assert.notEqual(asociados[0].participantId, 1, 'el parecido no le roba el sitio');

    const usados = asociados.map((a) => a.participantId).filter(Boolean);
    assert.equal(new Set(usados).size, usados.length, 'ningún participante repetido');
  });

  it('no busca fuera de los dos equipos', () => {
    // Alguien de otro partido del torneo no es candidato: el roster que se pasa
    // es sólo el de esta serie.
    const r = matchPlayer({ riotId: 'Jarti#OTRO', gameName: 'Jarti' }, roster);
    assert.equal(r.participantId, null);
  });
});

// =============================================================== IMÁGENES

describe('validación de imágenes', () => {
  it('reconoce PNG, JPEG y WebP de verdad', async () => {
    for (const format of ['png', 'jpeg', 'webp']) {
      const imagen = await renderScreenshot(['ASCENT', 'ALFA 13', 'BETA 8'], { format });
      const info = await inspectImage(imagen, { declaredMime: `image/${format}` });
      assert.equal(info.format, format);
      assert.ok(info.width >= 320 && info.height >= 180);
      assert.equal(info.sha256.length, 64);
    }
  });

  it('un SVG no es una imagen que aceptemos', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><script>alert(1)</script></svg>');
    await assert.rejects(() => inspectImage(svg, { declaredMime: 'image/svg+xml' }),
      (error) => error.code === 'UNSUPPORTED_TYPE');
  });

  it('un texto renombrado a .png se rechaza por sus bytes', async () => {
    const texto = Buffer.from('esto no es una imagen, por mucho que se llame captura.png');
    await assert.rejects(() => inspectImage(texto, { declaredMime: 'image/png' }),
      (error) => error.code === 'UNSUPPORTED_TYPE');
  });

  it('una imagen con la firma bien y el resto roto tampoco pasa', async () => {
    const buena = await renderScreenshot(['ASCENT']);
    // Firma PNG correcta, contenido destrozado: sharp no puede abrirla.
    const rota = Buffer.concat([buena.subarray(0, 16), Buffer.alloc(4096, 0x41)]);
    await assert.rejects(() => inspectImage(rota, { declaredMime: 'image/png' }),
      (error) => ['UNREADABLE_IMAGE', 'UNSUPPORTED_TYPE'].includes(error.code));
  });

  it('las firmas se leen de los bytes', async () => {
    const png = await renderScreenshot(['X'], { format: 'png' });
    const jpeg = await renderScreenshot(['X'], { format: 'jpeg' });
    const webp = await renderScreenshot(['X'], { format: 'webp' });
    assert.equal(sniffFormat(png), 'png');
    assert.equal(sniffFormat(jpeg), 'jpeg');
    assert.equal(sniffFormat(webp), 'webp');
    assert.equal(sniffFormat(Buffer.from('<svg></svg>')), null);
    assert.equal(sniffFormat(Buffer.alloc(4)), null);
  });

  it('rechaza vacíos y demasiado pequeños', async () => {
    await assert.rejects(() => inspectImage(Buffer.alloc(0)),
      (error) => error.code === 'EMPTY_FILE');
    const minuscula = await renderScreenshot(['X'], { width: 100 });
    await assert.rejects(() => inspectImage(minuscula),
      (error) => error.code === 'IMAGE_TOO_SMALL');
  });
});
