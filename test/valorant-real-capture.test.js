'use strict';

/**
 * Regresión con la partida real de Bind.
 *
 * ⚠️ Estos tests usan fixtures que reproducen el **layout** de las dos pantallas
 * reales, no los PNG originales. Prueban que el parser entiende esas interfaces:
 * columnas en español, celda K/D/A agrupada, filas de dos renglones, equipos
 * mezclados, etiquetas de Riot ID aparte y las dos formas del marcador.
 *
 * Lo que NO prueban es que Tesseract lea bien esos píxeles concretos. Eso es
 * la calibración, y necesita las imágenes de verdad.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResult } = require('../src/services/ocr');
const { classifyCapture, KINDS } = require('../src/services/captures/classify');
const { parseCapture } = require('../src/services/captures/parsers');
const { mergeCaptures } = require('../src/services/captures/merge');
const { reconcileField, reconcileScore, resolveTeamOrientation } = require('../src/services/captures/reconcile');
const { buildPreview } = require('../src/services/captures/ingest');
const { matchRoster } = require('../src/services/captures/match-players');
const F = require('../test/fixtures/real-match-bind');

/** Lee un fixture como lo haría la cadena real, con OCR falso. */
function leer(words) {
  const ocr = normalizeResult(F.fakeOcrFor(words));
  const tipo = classifyCapture(ocr);
  return { ocr, tipo, kind: tipo.kind, parsed: parseCapture(tipo.kind, ocr) };
}

const tracker = (opciones) => leer(F.trackerWords(opciones));
const cliente = (opciones) => leer(F.clientWords(opciones));

const buscar = (jugadores, nombre) =>
  jugadores.find((jugador) => (jugador.gameName || jugador.raw || '').includes(nombre));

// ================================================================== TRACKER

describe('captura real de Tracker (Bind)', () => {
  it('se reconoce sin que aparezca la marca por ninguna parte', () => {
    const { ocr, tipo } = tracker();
    assert.equal(/tracker/i.test(ocr.text), false,
      'la captura real no lleva escrito «tracker.gg»');
    assert.equal(tipo.kind, KINDS.TRACKER_MATCH);
    assert.ok(tipo.signals >= 2);
  });

  it('saca el mapa y el marcador orientado', () => {
    const { parsed } = tracker();
    assert.deepEqual(parsed.map, { key: 'bind', name: 'Bind' });
    assert.equal(parsed.teamARounds, 13);
    assert.equal(parsed.teamBRounds, 10);
  });

  it('separa los dos equipos, cinco y cinco', () => {
    const { parsed } = tracker();
    assert.equal(parsed.players.length, 10);
    assert.equal(parsed.players.filter((j) => j.visualTeam === 'A').length, 5);
    assert.equal(parsed.players.filter((j) => j.visualTeam === 'B').length, 5);
  });

  it('reconstruye los Riot ID cuya etiqueta va aparte', () => {
    const { parsed } = tracker();
    const porNombre = new Map(parsed.players.map((j) => [j.gameName, j]));

    assert.equal(porNombre.get('Luisbloom').riotId, 'Luisbloom#NANO');
    assert.equal(porNombre.get('Luisbloom').tagLine, 'NANO');
    assert.equal(porNombre.get('GreenElena').riotId, 'GreenElena#1409');
    assert.equal(porNombre.get('AlbertoYT19').riotId, 'AlbertoYT19#9047');

    // Quien no la enseña se queda sin etiqueta, y su nombre sigue sirviendo.
    assert.equal(porNombre.get('tilofuro').riotId, null);
    assert.equal(porNombre.get('tilofuro').gameName, 'tilofuro');

    // El rango que va entre el nombre y las columnas no se cuela en el nombre.
    for (const jugador of parsed.players) {
      assert.equal(/silver/i.test(jugador.gameName), false,
        `el rango se ha pegado al nombre: ${jugador.gameName}`);
    }
  });

  it('lee las catorce columnas de una fila', () => {
    const { parsed } = tracker();
    const luis = buscar(parsed.players, 'Luisbloom');
    assert.deepEqual({
      acs: luis.acs, k: luis.kills, d: luis.deaths, a: luis.assists,
      plusMinus: luis.plusMinus, kdRatio: luis.kdRatio, ddDelta: luis.ddDelta,
      adr: luis.adr, hs: luis.hsPercent, kast: luis.kastPercent,
      fk: luis.firstKills, fd: luis.firstDeaths, mk: luis.multiKills
    }, {
      acs: 213, k: 18, d: 15, a: 1,
      plusMinus: 3, kdRatio: 1.2, ddDelta: -5,
      adr: 129.6, hs: 19, kast: 78,
      fk: 2, fd: 3, mk: 1
    });
  });

  it('lee bien también a quien tiene números negativos', () => {
    const { parsed } = tracker();
    const alvlp = buscar(parsed.players, 'Alvlp10');
    assert.equal(alvlp.plusMinus, -17);
    assert.equal(alvlp.ddDelta, -111);
    assert.equal(alvlp.kills, 2);
    assert.equal(alvlp.deaths, 19);
  });

  it('el ADR conserva sus decimales', () => {
    const { parsed } = tracker();
    assert.equal(buscar(parsed.players, 'GreenElena').adr, 248.8);
    assert.equal(buscar(parsed.players, 'Alvlp10').adr, 31.2);
  });

  it('no trae agente: eso lo pone la captura del cliente', () => {
    const { parsed } = tracker();
    assert.equal(parsed.players.every((j) => j.agent === null), true);
  });
});

// ================================================================== CLIENTE

describe('captura real del cliente, en español (Bind)', () => {
  it('se reconoce por sus cabeceras en español', () => {
    const { tipo } = cliente();
    assert.equal(tipo.kind, KINDS.VALORANT_SCOREBOARD);
  });

  it('el marcador viene SIN orientar', () => {
    const { parsed } = cliente();
    // «10 DERROTA 13» es desde quien jugó: no dice de quién es cada cifra.
    assert.deepEqual(parsed.scorePair, [10, 13]);
    assert.equal(parsed.teamARounds, null);
    assert.equal(parsed.teamBRounds, null);
  });

  it('esta pantalla no enseña el mapa, y no se lo inventa', () => {
    const { parsed } = cliente();
    assert.equal(parsed.map, null);
  });

  it('lee las diez filas aunque los equipos vengan mezclados', () => {
    const { parsed } = cliente();
    assert.equal(parsed.players.length, 10);
    // El orden es el de la captura: por rendimiento, no por equipo.
    assert.deepEqual(parsed.players.map((j) => j.gameName), [...F.CLIENT_ORDER]);
    assert.equal(parsed.players.every((j) => j.visualTeam === null), true);
  });

  it('junta el agente que va en el renglón de debajo', () => {
    const { parsed } = cliente();
    const porNombre = new Map(parsed.players.map((j) => [j.gameName, j]));
    assert.equal(porNombre.get('Luisbloom').agent, 'Gekko');
    assert.equal(porNombre.get('GreenElena').agent, 'Cypher');
    assert.equal(porNombre.get('AlbertoYT19').agent, 'Iso');
    assert.equal(porNombre.get('choripanXd343').agent, 'Brimstone');
    // Y no lo confunde con otro jugador: siguen siendo diez filas.
    assert.equal(parsed.players.length, 10);
  });

  it('parte la celda agrupada de K/D/A', () => {
    const { parsed } = cliente();
    const luis = buscar(parsed.players, 'Luisbloom');
    assert.equal(luis.kills, 18);
    assert.equal(luis.deaths, 15);
    assert.equal(luis.assists, 1);

    const elena = buscar(parsed.players, 'GreenElena');
    assert.deepEqual([elena.kills, elena.deaths, elena.assists], [28, 9, 7]);
  });

  it('lee las columnas que sólo enseña el cliente', () => {
    const { parsed } = cliente();
    const luis = buscar(parsed.players, 'Luisbloom');
    assert.equal(luis.acs, 212);
    assert.equal(luis.economyRating, 57);
    assert.equal(luis.firstKills, 2);
    assert.equal(luis.spikesPlanted, 7);
    assert.equal(luis.defuses, 0, 'cero visible sí es cero');

    // Y las de Tracker no aparecen: no están en esta pantalla.
    assert.ok(luis.adr === null || luis.adr === undefined);
    assert.ok(luis.kastPercent === null || luis.kastPercent === undefined);
  });
});

// ============================================================ RECONCILIACIÓN

describe('conciliar las dos fuentes', () => {
  it('una diferencia de 1 en ACS no es un conflicto', () => {
    const resultado = reconcileField('acs', [
      { source: 'VALORANT', captureId: 1, value: 212 },
      { source: 'TRACKER', captureId: 2, value: 213 }
    ]);
    assert.equal(resultado.conflict, null);
    assert.ok(resultado.variance, 'tiene que quedar anotada');
    assert.equal(resultado.variance.code, 'ROUNDING_VARIANCE');
    // Manda el cliente, que es el dato de primera mano.
    assert.equal(resultado.value, 212);
    assert.equal(resultado.canonicalSource, 'VALORANT');
    // Y no se pierde lo que decía Tracker.
    assert.deepEqual(resultado.observations, [
      { source: 'VALORANT', captureId: 1, value: 212 },
      { source: 'TRACKER', captureId: 2, value: 213 }
    ]);
  });

  it('la tolerancia es de ese campo, no de todos', () => {
    // Las bajas son una cuenta: una de diferencia es un error de lectura.
    const kills = reconcileField('kills', [
      { source: 'VALORANT', captureId: 1, value: 18 },
      { source: 'TRACKER', captureId: 2, value: 19 }
    ]);
    assert.ok(kills.conflict, 'un K distinto sí es conflicto');
    assert.equal(kills.variance, null);

    // Y un ACS que difiere en más de 1 tampoco pasa.
    const acs = reconcileField('acs', [
      { source: 'VALORANT', captureId: 1, value: 212 },
      { source: 'TRACKER', captureId: 2, value: 260 }
    ]);
    assert.ok(acs.conflict);
  });

  it('un campo que sólo enseña una fuente no se compara con la otra', () => {
    const resultado = reconcileField('adr', [
      { source: 'TRACKER', captureId: 1, value: 129.6 },
      { source: 'VALORANT', captureId: 2, value: 999 }
    ]);
    assert.equal(resultado.conflict, null);
    assert.equal(resultado.value, 129.6, 'el ADR es de Tracker y punto');
  });

  it('faltar no es discrepar', () => {
    const resultado = reconcileField('kastPercent', [
      { source: 'TRACKER', captureId: 1, value: 78 },
      { source: 'VALORANT', captureId: 2, value: null }
    ]);
    assert.equal(resultado.conflict, null);
    assert.equal(resultado.value, 78);
  });

  it('un marcador invertido es compatible, no un conflicto', () => {
    const bien = reconcileScore({ oriented: [13, 10], unordered: [10, 13] });
    assert.equal(bien.ok, true);
    assert.equal(bien.teamARounds, 13);
    assert.equal(bien.corroborated, true);
  });

  it('un marcador que no cuadra sí lo es', () => {
    const mal = reconcileScore({ oriented: [13, 9], unordered: [10, 13] });
    assert.equal(mal.ok, false);
    assert.equal(mal.code, 'SCORE_CONFLICT');
  });

  it('sin fuente que oriente, el marcador se queda sin asignar', () => {
    const solo = reconcileScore({ oriented: null, unordered: [10, 13] });
    assert.equal(solo.ok, false);
    assert.equal(solo.code, 'SCORE_NOT_ORIENTED');
    assert.deepEqual(solo.pair, [10, 13]);
  });
});

// ============================================================== ORIENTACIÓN

describe('a qué equipo del torneo corresponde cada lado', () => {
  const equipoDe = new Map([[1, 27], [2, 27], [3, 27], [4, 27], [5, 27],
    [6, 31], [7, 31], [8, 31], [9, 31], [10, 31]]);
  const serie = { teamAId: 27, teamBId: 31 };

  const filas = (asignacion) => asignacion.map(([participantId, visualTeam]) =>
    ({ participantId, visualTeam }));

  it('se resuelve con quién sale en cada lado', () => {
    const r = resolveTeamOrientation(filas([
      [1, 'A'], [2, 'A'], [3, 'A'], [4, 'A'], [5, 'A'],
      [6, 'B'], [7, 'B'], [8, 'B'], [9, 'B'], [10, 'B']
    ]), serie, equipoDe);
    assert.equal(r.ok, true);
    assert.equal(r.teamAId, 27);
    assert.equal(r.swapped, false);
  });

  it('detecta que la captura viene al revés que la serie', () => {
    const r = resolveTeamOrientation(filas([
      [6, 'A'], [7, 'A'], [8, 'A'], [9, 'A'], [10, 'A'],
      [1, 'B'], [2, 'B'], [3, 'B'], [4, 'B'], [5, 'B']
    ]), serie, equipoDe);
    assert.equal(r.ok, true);
    assert.equal(r.teamAId, 31, 'el Team A de la captura es el equipo 31');
    assert.equal(r.swapped, true, 'hay que dar la vuelta al marcador');
  });

  it('aguanta que el OCR pierda alguna fila', () => {
    const r = resolveTeamOrientation(filas([
      [1, 'A'], [2, 'A'], [3, 'A'], [4, 'A'],
      [6, 'B'], [7, 'B'], [8, 'B']
    ]), serie, equipoDe);
    assert.equal(r.ok, true, 'sigue siendo inequívoco');
    assert.equal(r.teamAId, 27);
    assert.ok(r.confidence < 1);
  });

  it('con los lados mezclados no se decide', () => {
    const r = resolveTeamOrientation(filas([
      [1, 'A'], [6, 'A'], [2, 'A'],
      [7, 'B'], [3, 'B']
    ]), serie, equipoDe);
    assert.equal(r.ok, false);
  });

  it('sin lados no se decide', () => {
    const r = resolveTeamOrientation(
      [1, 2, 3].map((participantId) => ({ participantId, visualTeam: null })), serie, equipoDe);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ORIENTATION_UNKNOWN');
  });
});

// ==================================================================== FUSIÓN

describe('las dos capturas reales, fusionadas', () => {
  const fusionar = (opciones = {}) => {
    const t = tracker(opciones.tracker);
    const c = cliente(opciones.cliente);
    return mergeCaptures([
      { captureId: 1, kind: t.kind, parsed: t.parsed },
      { captureId: 2, kind: c.kind, parsed: c.parsed }
    ]);
  };

  it('sale Bind, 13-10 y diez jugadores, sin conflictos', () => {
    const fusion = fusionar();
    assert.equal(fusion.map, 'bind');
    assert.equal(fusion.teamARounds, 13);
    assert.equal(fusion.teamBRounds, 10);
    assert.equal(fusion.score.corroborated, true);
    assert.equal(fusion.players.length, 10, 'nadie duplicado');
    assert.deepEqual(fusion.conflicts, [], JSON.stringify(fusion.conflicts));
  });

  it('las diferencias de redondeo quedan anotadas, no bloquean', () => {
    const fusion = fusionar();
    assert.ok(fusion.variances.length >= 5,
      `esperaba varias diferencias de ACS, hubo ${fusion.variances.length}`);
    assert.equal(fusion.variances.every((v) => v.code === 'ROUNDING_VARIANCE'), true);
    assert.equal(fusion.variances.every((v) => v.field === 'acs'), true);
    assert.equal(fusion.variances.every((v) => v.difference === 1), true);
  });

  it('la misma persona no se duplica por llevar etiqueta en una sola captura', () => {
    const fusion = fusionar();
    const nombres = fusion.players.map((j) => j.gameName);
    assert.equal(new Set(nombres).size, 10);
    const luis = buscar(fusion.players, 'Luisbloom');
    assert.equal(luis.riotId, 'Luisbloom#NANO', 'gana el nombre más completo');
    assert.deepEqual(luis.sources.sort(), ['TRACKER', 'VALORANT']);
  });

  it('Luisbloom queda con las estadísticas de las dos fuentes', () => {
    const luis = buscar(fusionar().players, 'Luisbloom');
    assert.deepEqual({
      riotId: luis.riotId, agent: luis.agent, acs: luis.acs,
      kills: luis.kills, deaths: luis.deaths, assists: luis.assists,
      plusMinus: luis.plusMinus, kdRatio: luis.kdRatio, ddDelta: luis.ddDelta,
      adr: luis.adr, hsPercent: luis.hsPercent, kastPercent: luis.kastPercent,
      firstKills: luis.firstKills, firstDeaths: luis.firstDeaths, multiKills: luis.multiKills,
      economyRating: luis.economyRating, spikesPlanted: luis.spikesPlanted, defuses: luis.defuses
    }, {
      riotId: 'Luisbloom#NANO', agent: 'Gekko', acs: 212,
      kills: 18, deaths: 15, assists: 1,
      plusMinus: 3, kdRatio: 1.2, ddDelta: -5,
      adr: 129.6, hsPercent: 19, kastPercent: 78,
      firstKills: 2, firstDeaths: 3, multiKills: 1,
      economyRating: 57, spikesPlanted: 7, defuses: 0
    });
  });

  it('se conserva lo que decía cada fuente del ACS', () => {
    const luis = buscar(fusionar().players, 'Luisbloom');
    const observaciones = luis.observations.acs;
    assert.equal(observaciones.length, 2);
    assert.equal(observaciones.find((o) => o.source === 'VALORANT').value, 212);
    assert.equal(observaciones.find((o) => o.source === 'TRACKER').value, 213);
  });

  it('las primeras sangres de las dos fuentes se corroboran', () => {
    const fusion = fusionar();
    // Tracker las llama FK y el cliente PRIMERAS SANGRES: aquí coinciden.
    assert.equal(fusion.conflicts.some((c) => c.field === 'firstKills'), false);
    assert.equal(buscar(fusion.players, 'AlbertoYT19').firstKills, 5);
    assert.equal(buscar(fusion.players, 'GreenElena').firstKills, 3);
  });

  it('un marcador que no cuadra sí es conflicto, y el ACS sigue sin serlo', () => {
    // Tracker dice 13-9; el cliente sigue diciendo 10-13.
    const fusion = fusionar({ tracker: { teamBRounds: 9 } });
    const marcador = fusion.conflicts.find((c) => c.field === 'score');
    assert.ok(marcador, `esperaba conflicto de marcador: ${JSON.stringify(fusion.conflicts)}`);
    assert.equal(fusion.conflicts.some((c) => c.field === 'acs'), false,
      'la tolerancia del ACS no se ve afectada');
    assert.ok(fusion.variances.some((v) => v.field === 'acs'));
  });

  it('un mapa que sólo enseña una fuente no es conflicto', () => {
    const fusion = fusionar();
    assert.equal(fusion.conflicts.some((c) => c.field === 'map'), false);
    assert.equal(fusion.map, 'bind');
  });
});

// ============================================== PREVISUALIZACIÓN CON ROSTER

describe('previsualización con los equipos del torneo', () => {
  /** Los diez inscritos, repartidos como en la partida real. */
  function rosterReal({ ganadorId = 27, perdedorId = 31 } = {}) {
    const filas = [];
    F.TEAM_A.forEach((jugador, indice) => filas.push({
      participantId: 100 + indice, teamId: ganadorId, teamName: 'Ganadores',
      displayName: jugador.name, riotId: jugador.tag ? `${jugador.name}#${jugador.tag}` : null
    }));
    F.TEAM_B.forEach((jugador, indice) => filas.push({
      participantId: 200 + indice, teamId: perdedorId, teamName: 'Perdedores',
      displayName: jugador.name, riotId: jugador.tag ? `${jugador.name}#${jugador.tag}` : null
    }));
    return filas;
  }

  const lecturas = (opciones = {}) => {
    const t = tracker(opciones.tracker);
    const c = cliente(opciones.cliente);
    return [
      { captureId: 1, sourceKind: t.kind, parsed: t.parsed, confidence: 0.93 },
      { captureId: 2, sourceKind: c.kind, parsed: c.parsed, confidence: 0.93 }
    ];
  };

  it('queda READY, con el marcador puesto en el equipo correcto', () => {
    const roster = rosterReal();
    const preview = buildPreview(lecturas(), {
      roster, expectedMap: 'bind', teamAId: 27, teamBId: 31
    });

    assert.equal(preview.status, 'READY',
      `avisos: ${JSON.stringify(preview.issues)}`);
    assert.equal(preview.map, 'bind');
    assert.equal(preview.teamARounds, 13);
    assert.equal(preview.teamBRounds, 10);
    assert.equal(preview.players.length, 10);
    assert.equal(preview.players.every((j) => j.participantId), true);
    assert.equal(preview.orientation.swapped, false);
  });

  it('si la serie tiene los equipos al revés, el marcador se da la vuelta', () => {
    // El mismo partido, pero en el torneo el ganador es el «equipo B».
    const roster = rosterReal({ ganadorId: 31, perdedorId: 27 });
    const preview = buildPreview(lecturas(), {
      roster, expectedMap: 'bind', teamAId: 27, teamBId: 31
    });

    assert.equal(preview.status, 'READY', JSON.stringify(preview.issues));
    assert.equal(preview.orientation.swapped, true);
    // El 13 va al equipo que de verdad ganó, no al que salía primero.
    assert.equal(preview.teamARounds, 10);
    assert.equal(preview.teamBRounds, 13);
  });

  it('las diferencias de redondeo salen como nota, no como aviso', () => {
    const preview = buildPreview(lecturas(), {
      roster: rosterReal(), expectedMap: 'bind', teamAId: 27, teamBId: 31
    });
    assert.equal(preview.issues.length, 0);
    assert.ok(preview.notes.length >= 5);
    assert.equal(preview.notes.every((n) => n.code === 'ROUNDING_VARIANCE'), true);
  });

  it('un marcador discrepante manda el lote a revisión', () => {
    const preview = buildPreview(lecturas({ tracker: { teamBRounds: 9 } }), {
      roster: rosterReal(), expectedMap: 'bind', teamAId: 27, teamBId: 31
    });
    assert.equal(preview.status, 'REVIEW_REQUIRED');
    assert.ok(preview.issues.some((i) => i.code === 'CONFLICT' && i.field === 'score'),
      JSON.stringify(preview.issues));
    // Y el ACS sigue sin dar problemas.
    assert.equal(preview.issues.some((i) => i.field === 'acs'), false);
  });

  it('con sólo la captura del cliente no se puede asignar el marcador', () => {
    const c = cliente();
    const preview = buildPreview([
      { captureId: 1, sourceKind: c.kind, parsed: c.parsed, confidence: 0.93 }
    ], { roster: rosterReal(), expectedMap: 'bind', teamAId: 27, teamBId: 31 });

    assert.equal(preview.status, 'REVIEW_REQUIRED');
    assert.ok(preview.issues.some((i) => i.code === 'SCORE_NOT_ORIENTED'),
      JSON.stringify(preview.issues.map((i) => i.code)));
    assert.equal(preview.teamARounds, null);
    // Pero los jugadores y sus estadísticas sí se han leído.
    assert.equal(preview.players.filter((j) => j.participantId).length, 10);
  });

  it('el mapa que no coincide con el asignado se avisa', () => {
    const preview = buildPreview(lecturas(), {
      roster: rosterReal(), expectedMap: 'ascent', teamAId: 27, teamBId: 31
    });
    assert.equal(preview.status, 'REVIEW_REQUIRED');
    const problema = preview.issues.find((i) => i.code === 'MAP_MISMATCH');
    assert.equal(problema.detected, 'bind');
    assert.equal(problema.expected, 'ascent');
  });

  it('los diez se asocian por Riot ID o por nombre exacto', () => {
    const roster = rosterReal();
    const asociados = matchRoster(
      mergeCaptures(lecturas().map((l) => ({ captureId: l.captureId, kind: l.sourceKind, parsed: l.parsed }))).players,
      roster);

    assert.equal(asociados.length, 10);
    assert.equal(asociados.every((j) => j.participantId), true);
    assert.equal(new Set(asociados.map((j) => j.participantId)).size, 10, 'nadie repetido');
    // Quien lleva etiqueta se asocia por el Riot ID entero.
    assert.equal(buscar(asociados, 'Luisbloom').match, 'RIOT_ID');
    // Quien no la lleva, por el nombre.
    assert.equal(buscar(asociados, 'tilofuro').match, 'GAME_NAME');
  });
});
