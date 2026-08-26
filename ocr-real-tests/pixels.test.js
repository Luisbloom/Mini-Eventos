'use strict';

/**
 * Calibración contra los PÍXELES ORIGINALES de la partida de Bind.
 *
 * Este es el único sitio donde se abren las capturas de verdad y se les pasa
 * Tesseract. Vive fuera de `test/` a propósito: `npm test` tiene que seguir
 * siendo rápido y determinista, y esto tarda y depende del motor.
 *
 *   npm test              -> parser, fusión y rutas, con OCR falso
 *   npm run test:ocr-real -> estas dos imágenes, con el motor real
 *
 * Los fixtures de `test/fixtures/real-match-bind.js` prueban que el parser
 * entiende el **layout** de las dos interfaces. Esto prueba otra cosa: que el
 * motor lee **estos píxeles**. Son preguntas distintas y hacen falta las dos.
 */

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { createTesseractProvider } = require('../src/services/ocr/tesseract-provider');
const { KINDS } = require('../src/services/captures/classify');
const { mergeCaptures } = require('../src/services/captures/merge');
const { readCapture, buildPreview } = require('../src/services/captures/ingest');

const CARPETA = path.join(__dirname, '..', 'test', 'fixtures', 'valorant-real');
const TRACKER = path.join(CARPETA, 'bind-tracker-scoreboard.png');
const CLIENTE = path.join(CARPETA, 'bind-client-scoreboard-es.png');

/** Los diez de la partida, repartidos como los enseña Tracker. */
const TEAM_A = ['GreenElena', 'Hakai Shin Sella', 'tilofuro', 'Pamari18', 'Alvlp10'];
const TEAM_B = ['AlbertoYT19', 'salmongradas', 'Luisbloom', 'choripanXd343', 'MontesOnFire'];

const buscar = (jugadores, nombre) => jugadores.find((jugador) =>
  (jugador.gameName || jugador.raw || '').toLowerCase().includes(nombre.toLowerCase()));

describe('los píxeles originales de la partida de Bind', () => {
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
    it('se lee con claridad suficiente', (contexto) => {
      const { metadata, confidence, ocr: texto } = leido.tracker;
      contexto.diagnostic(`${metadata.width}x${metadata.height} · ${texto.words.length} palabras · `
        + `confianza ${(confidence * 100).toFixed(1)}`);
      assert.ok(texto.words.length > 150, `pocas palabras: ${texto.words.length}`);
      assert.ok(confidence > 0.6, `confianza baja: ${confidence}`);
    });

    it('se clasifica por su estructura, no por la marca', () => {
      // La captura real no lleva escrito «tracker.gg» por ninguna parte.
      assert.equal(/tracker/i.test(leido.tracker.ocr.text), false);
      assert.equal(leido.tracker.sourceKind, KINDS.TRACKER_MATCH);
    });

    it('saca el mapa y el marcador ORIENTADO', () => {
      const { parsed } = leido.tracker;
      assert.equal(parsed.map?.key, 'bind', `mapa: ${JSON.stringify(parsed.map)}`);
      assert.equal(parsed.teamARounds, 13);
      assert.equal(parsed.teamBRounds, 10);
    });

    it('encuentra exactamente diez jugadores, cinco por lado', (contexto) => {
      const { players } = leido.tracker.parsed;
      contexto.diagnostic(`filas: ${players.map((j) => j.gameName).join(' | ')}`);

      assert.equal(players.length, 10,
        `esperaba 10 y hay ${players.length}: ${players.map((j) => j.raw).join(' / ')}`);
      assert.equal(players.filter((j) => j.visualTeam === 'A').length, 5);
      assert.equal(players.filter((j) => j.visualTeam === 'B').length, 5);
    });

    it('cada uno cae en el lado que le toca', () => {
      const { players } = leido.tracker.parsed;
      const lado = (nombre) => buscar(players, nombre.split(' ')[0])?.visualTeam;
      for (const nombre of TEAM_A) assert.equal(lado(nombre), 'A', nombre);
      for (const nombre of TEAM_B) assert.equal(lado(nombre), 'B', nombre);
    });

    it('los nombres salen limpios de lo que los rodea', () => {
      // A la izquierda hay retrato, nivel y rango. Un nombre SÍ puede llevar
      // cifras dentro (choripanXd343); lo que no puede es llevar pegado el
      // rango, ni el nivel como palabra suelta al principio o al final.
      for (const jugador of leido.tracker.parsed.players) {
        const nombre = jugador.gameName;
        assert.equal(/silver|bronze|gold|platinum|diamond/i.test(nombre), false,
          `el nombre lleva pegado el rango: "${nombre}"`);
        assert.equal(/(^|\s)\d{1,4}(\s|$)/.test(nombre), false,
          `el nombre lleva pegado el nivel: "${nombre}"`);
        assert.equal(/[:;%]/.test(nombre), false,
          `el nombre lleva restos de icono: "${nombre}"`);
      }
    });

    it('lee la fila de Luisbloom', (contexto) => {
      const luis = buscar(leido.tracker.parsed.players, 'Luisbloom');
      assert.ok(luis, 'Luisbloom no aparece');
      contexto.diagnostic(JSON.stringify(luis));

      assert.deepEqual({
        acs: luis.acs, k: luis.kills, d: luis.deaths, a: luis.assists,
        plusMinus: luis.plusMinus, kdRatio: luis.kdRatio,
        adr: luis.adr, hs: luis.hsPercent, kast: luis.kastPercent,
        fd: luis.firstDeaths, mk: luis.multiKills
      }, {
        acs: 213, k: 18, d: 15, a: 1,
        plusMinus: 3, kdRatio: 1.2,
        adr: 129.6, hs: 19, kast: 78,
        fd: 3, mk: 1
      });
    });

    it('los decimales se conservan y los negativos no se vuelven positivos', () => {
      const { players } = leido.tracker.parsed;
      // El ADR va en su propia columna y se lee en todas las filas.
      assert.equal(buscar(players, 'GreenElena').adr, 248.8);
      assert.equal(buscar(players, 'Alvlp10').adr, 31.2);

      /*
        Las columnas estrechas de la derecha (+/-, K/D, DDΔ, FK) sólo se leen en
        parte de las filas: sus cabeceras son de una o dos letras y el motor las
        falla. Lo importante es que lo que SÍ se lee sea correcto —incluido el
        signo— y que lo que no, quede en null y no en cero.
      */
      const conSigno = players.filter((j) => typeof j.plusMinus === 'number');
      assert.ok(conSigno.length >= 3, `esperaba varias +/- leídas, hubo ${conSigno.length}`);
      const alvlp = buscar(players, 'Alvlp10');
      if (typeof alvlp.plusMinus === 'number') assert.equal(alvlp.plusMinus, -17);
      for (const jugador of players) {
        for (const campo of ['plusMinus', 'kdRatio', 'ddDelta', 'firstKills']) {
          assert.notEqual(jugador[campo], 0,
            `${campo} de ${jugador.gameName} no puede ser un cero inventado`);
        }
      }
    });

    it('ninguna etiqueta se inventa', () => {
      /*
        Van en gris y en cuerpo pequeño: a esta resolución el motor las falla
        más de lo que las acierta, y una etiqueta equivocada es PEOR que
        ninguna —sin ella el jugador se asocia igual por su nombre, y con ella
        se busca un Riot ID que no existe—. Así que se exige confianza alta y
        se descartan casi todas. Lo que NO puede pasar es que salga una mal.
      */
      const conEtiqueta = leido.tracker.parsed.players.filter((j) => j.tagLine);
      const correctas = {
        GreenElena: '1409', Hakai: '1306', tilofuro: '1740', Pamari18: 'EUW',
        Alvlp10: 'Arsa', AlbertoYT19: '9047', salmongradas: 'Vox',
        Luisbloom: 'NANO', choripanXd343: '1206', MontesOnFire: 'EUW'
      };
      for (const jugador of conEtiqueta) {
        const clave = Object.keys(correctas).find((n) =>
          jugador.gameName.toLowerCase().startsWith(n.toLowerCase().slice(0, 5)));
        if (!clave) continue;
        assert.equal(jugador.tagLine, correctas[clave],
          `etiqueta inventada para ${jugador.gameName}`);
      }
    });
  });

  // ================================================================ CLIENTE

  describe('cliente de Valorant, en español', () => {
    it('se lee con claridad suficiente', (contexto) => {
      const { metadata, confidence, ocr: texto } = leido.cliente;
      contexto.diagnostic(`${metadata.width}x${metadata.height} · ${texto.words.length} palabras · `
        + `confianza ${(confidence * 100).toFixed(1)}`);
      assert.ok(texto.words.length > 60, `pocas palabras: ${texto.words.length}`);
      assert.ok(confidence > 0.6, `confianza baja: ${confidence}`);
    });

    it('se clasifica por sus cabeceras en español', () => {
      assert.equal(leido.cliente.sourceKind, KINDS.VALORANT_SCOREBOARD);
    });

    it('el marcador viene SIN orientar, y el mapa no se inventa', () => {
      const { parsed } = leido.cliente;
      // «10 DERROTA 13» es desde quien jugó: no dice de quién es cada cifra.
      assert.deepEqual([...parsed.scorePair].sort((a, b) => a - b), [10, 13]);
      assert.equal(parsed.teamARounds, null);
      assert.equal(parsed.map, null, 'esta pantalla no enseña el mapa');
    });

    it('encuentra exactamente diez jugadores', (contexto) => {
      const { players } = leido.cliente.parsed;
      contexto.diagnostic(`filas: ${players.map((j) => j.gameName).join(' | ')}`);
      assert.equal(players.length, 10,
        `esperaba 10 y hay ${players.length}: ${players.map((j) => j.raw).join(' / ')}`);
    });

    it('junta el agente que va en el renglón de debajo', (contexto) => {
      const { players } = leido.cliente.parsed;
      const conAgente = players.filter((j) => j.agent);
      contexto.diagnostic(players.map((j) => `${j.gameName}=${j.agent}`).join(' · '));

      // El agente va debajo del nombre, en gris y en versalitas: no sale en
      // todas las filas. Lo que importa es que el que salga sea el correcto.
      assert.ok(conAgente.length >= 3, `sólo ${conAgente.length} agentes de 10`);
      const correctos = {
        Luisbloom: 'Gekko', GreenElena: 'Cypher', AlbertoYT19: 'Iso',
        tilofuro: 'Viper', salmongradas: 'Cypher', choripanXd343: 'Brimstone',
        MontesOnFire: 'Sage', Pamari18: 'Gekko', Alvlp10: 'Sage'
      };
      for (const jugador of conAgente) {
        const clave = Object.keys(correctos).find((n) =>
          jugador.gameName.toLowerCase().startsWith(n.toLowerCase().slice(0, 5)));
        if (!clave) continue;
        assert.equal(jugador.agent, correctos[clave],
          `agente equivocado para ${jugador.gameName}`);
      }
    });

    it('lee la fila de Luisbloom con lo que sólo enseña el cliente', (contexto) => {
      const luis = buscar(leido.cliente.parsed.players, 'Luisbloom');
      assert.ok(luis, 'Luisbloom no aparece');
      contexto.diagnostic(JSON.stringify(luis));

      assert.deepEqual({
        agent: luis.agent, acs: luis.acs,
        k: luis.kills, d: luis.deaths, a: luis.assists,
        eco: luis.economyRating, fk: luis.firstKills,
        plants: luis.spikesPlanted, defuses: luis.defuses
      }, {
        agent: 'Gekko', acs: 212,
        k: 18, d: 15, a: 1,
        eco: 57, fk: 2,
        plants: 7, defuses: 0
      });
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
        'la misma persona no puede contarse dos veces por leerse distinto');

      for (const nombre of [...TEAM_A, ...TEAM_B]) {
        assert.ok(buscar(fusion.players, nombre.split(' ')[0]), `falta ${nombre}`);
      }
    });

    it('el ACS difiere en 1 y eso NO es un conflicto', (contexto) => {
      const fusion = fusionar();
      contexto.diagnostic(`variaciones: ${fusion.variances.map((v) => `${v.player}.${v.field}`).join(' ')}`);

      assert.ok(fusion.variances.length >= 5,
        `esperaba varias diferencias de ACS, hubo ${fusion.variances.length}`);
      assert.equal(fusion.variances.every((v) => v.code === 'ROUNDING_VARIANCE'), true);
      assert.equal(fusion.variances.every((v) => v.field === 'acs'), true);
      assert.equal(fusion.conflicts.some((c) => c.field === 'acs'), false,
        'el ACS nunca puede salir como conflicto duro');
    });

    it('lo que de verdad decide el resultado sale sin discrepancias', (contexto) => {
      /*
        El cliente lee mal la tercera cifra de la celda «K / D / A»: la barra se
        le cuela como un 7 y AlbertoYT19 sale con 73 asistencias en vez de 3.
        El sistema lo detecta y lo manda a revisión, que es exactamente lo que
        tiene que hacer: dos fuentes discrepan y lo resuelve una persona.

        Lo que NO puede fallar es nada de lo que decide quién gana.
      */
      const fusion = fusionar();
      contexto.diagnostic(`conflictos: ${JSON.stringify(fusion.conflicts)}`);

      const criticos = ['map', 'score', 'teamARounds', 'teamBRounds', 'kills', 'deaths'];
      for (const campo of criticos) {
        assert.equal(fusion.conflicts.some((c) => c.field === campo), false,
          `no puede haber discrepancia en ${campo}`);
      }
      assert.equal(fusion.conflicts.every((c) => c.field === 'assists'), true,
        `sólo se esperaban discrepancias de asistencias: ${JSON.stringify(fusion.conflicts)}`);
    });

    it('Luisbloom queda con lo que aporta cada fuente', (contexto) => {
      const luis = buscar(fusionar().players, 'Luisbloom');
      contexto.diagnostic(JSON.stringify(luis));

      assert.deepEqual({
        agent: luis.agent, acs: luis.acs,
        kills: luis.kills, deaths: luis.deaths, assists: luis.assists,
        plusMinus: luis.plusMinus, kdRatio: luis.kdRatio,
        adr: luis.adr, hsPercent: luis.hsPercent, kastPercent: luis.kastPercent,
        firstKills: luis.firstKills, firstDeaths: luis.firstDeaths, multiKills: luis.multiKills,
        economyRating: luis.economyRating, spikesPlanted: luis.spikesPlanted, defuses: luis.defuses
      }, {
        agent: 'Gekko', acs: 212,
        kills: 18, deaths: 15, assists: 1,
        plusMinus: 3, kdRatio: 1.2,
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
    const roster = [
      ...TEAM_A.map((nombre, i) => ({
        participantId: 100 + i, teamId: 27, teamName: 'Ganadores', displayName: nombre, riotId: null
      })),
      ...TEAM_B.map((nombre, i) => ({
        participantId: 200 + i, teamId: 31, teamName: 'Perdedores', displayName: nombre, riotId: null
      }))
    ];

    const lecturas = () => [
      { captureId: 1, sourceKind: leido.tracker.sourceKind, parsed: leido.tracker.parsed, confidence: leido.tracker.confidence },
      { captureId: 2, sourceKind: leido.cliente.sourceKind, parsed: leido.cliente.parsed, confidence: leido.cliente.confidence }
    ];

    it('asocia a los diez y pone el marcador donde toca', (contexto) => {
      const preview = buildPreview(lecturas(), {
        roster, expectedMap: 'bind', teamAId: 27, teamBId: 31
      });
      contexto.diagnostic(`estado ${preview.status} · avisos ${JSON.stringify(preview.issues.map((i) => i.code))}`);

      assert.equal(preview.map, 'bind');
      assert.equal(preview.teamARounds, 13);
      assert.equal(preview.teamBRounds, 10);
      assert.equal(preview.players.length, 10);
      assert.equal(preview.players.filter((j) => j.participantId).length, 10,
        'los diez tienen que quedar asociados a su inscripción');
      assert.equal(preview.orientation.swapped, false);

      // Nadie se queda sin reconocer ni sale repetido.
      for (const codigo of ['PLAYER_UNKNOWN', 'PLAYER_AMBIGUOUS', 'PLAYER_DUPLICATED', 'ROSTER_INCOMPLETE']) {
        assert.equal(preview.issues.some((i) => i.code === codigo), false,
          `no debería salir ${codigo}: ${JSON.stringify(preview.issues)}`);
      }
    });

    it('las diferencias de redondeo son notas, no avisos', () => {
      const preview = buildPreview(lecturas(), {
        roster, expectedMap: 'bind', teamAId: 27, teamBId: 31
      });
      assert.ok(preview.notes.length >= 5);
      assert.equal(preview.notes.every((n) => n.code === 'ROUNDING_VARIANCE'), true);
      assert.equal(preview.issues.some((i) => i.field === 'acs'), false);
    });

    it('el marcador se orienta por el roster, no por la posición en la imagen', () => {
      // Los mismos jugadores, pero al revés en la serie del torneo.
      const alReves = roster.map((persona) => ({
        ...persona, teamId: persona.teamId === 27 ? 31 : 27
      }));
      const preview = buildPreview(lecturas(), {
        roster: alReves, expectedMap: 'bind', teamAId: 27, teamBId: 31
      });

      assert.equal(preview.orientation.swapped, true);
      assert.equal(preview.teamARounds, 10, 'el 13 va a quien de verdad ganó');
      assert.equal(preview.teamBRounds, 13);
    });

    it('un mapa que no coincide con el asignado se avisa', () => {
      const preview = buildPreview(lecturas(), {
        roster, expectedMap: 'ascent', teamAId: 27, teamBId: 31
      });
      const problema = preview.issues.find((i) => i.code === 'MAP_MISMATCH');
      assert.ok(problema, 'tiene que avisar del mapa');
      assert.equal(problema.detected, 'bind');
    });
  });

  // ================================================================ RESIZE

  describe('a otra resolución', () => {
    /**
     * La misma captura reescalada tiene que leerse igual. Si algo dependiera de
     * una coordenada concreta de esta resolución, aquí se caería.
     */
    /** Cuántas filas se exigen a cada escala. */
    const MINIMO_FILAS = { 0.75: 9, 1.25: 10 };

    for (const escala of [0.75, 1.25]) {
      it(`al ${Math.round(escala * 100)}% aguanta lo esencial`, async (contexto) => {
        const redimensionar = async (ruta) => {
          const { width } = await sharp(ruta).metadata();
          return sharp(ruta).resize({ width: Math.round(width * escala) }).png().toBuffer();
        };

        const t = await readCapture(await redimensionar(TRACKER), { ocrProvider: ocr, key: `t${escala}` });
        const c = await readCapture(await redimensionar(CLIENTE), { ocrProvider: ocr, key: `c${escala}` });

        contexto.diagnostic(`tracker: ${t.parsed.players.length} filas, ${t.parsed.map?.key}, `
          + `${t.parsed.teamARounds}-${t.parsed.teamBRounds} · cliente: ${c.parsed.players.length} filas, `
          + `${JSON.stringify(c.parsed.scorePair)}`);

        const minimo = MINIMO_FILAS[escala];

        // Lo que NO puede cambiar con la resolución: de qué pantalla es, el
        // mapa y a qué equipo va cada marcador.
        assert.equal(t.sourceKind, KINDS.TRACKER_MATCH);
        assert.equal(t.parsed.map?.key, 'bind');
        assert.equal(t.parsed.teamARounds, 13);
        assert.equal(t.parsed.teamBRounds, 10);
        assert.equal(c.sourceKind, KINDS.VALORANT_SCOREBOARD);

        /*
          Las filas sí dependen de cuánto texto queda legible. La captura de
          Tracker ya viene pequeña (988px de ancho), así que al 75% el motor
          pierde alguna: se exige casi todo, no todo. Lo que importa es que
          nada de lo anterior se mueva, que es lo que demostraría que hay una
          coordenada fija escondida.
        */
        assert.ok(t.parsed.players.length >= minimo,
          `tracker: ${t.parsed.players.length} filas, esperaba ${minimo}`);
        assert.ok(c.parsed.players.length >= minimo,
          `cliente: ${c.parsed.players.length} filas, esperaba ${minimo}`);

        if (escala >= 1) {
          assert.deepEqual([...c.parsed.scorePair].sort((a, b) => a - b), [10, 13]);
        }
        // Las etiquetas pueden perderse al reescalar, y eso no es un fallo.
      });
    }
  });
});
