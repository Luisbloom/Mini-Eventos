'use strict';

/**
 * El desempate por estadísticas.
 *
 * Decidido el 2026-09-01: si ni las victorias, ni el enfrentamiento directo,
 * ni la diferencia de rondas separan a dos equipos, va delante el que mejores
 * estadísticas tenga. Se mide con el ACS medio de sus jugadores, que es la
 * medida estándar de quién jugó mejor.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/database');

describe('desempate por estadísticas', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-desempate-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const NOMBRES = Array.from({ length: 20 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`);

  /** Liga de cuatro equipos con el draft hecho. */
  function ligaMontada() {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'liga-desempate', name: 'Liga', game: 'Valorant', description: 'x',
      status: 'Inscripciones abiertas', registrationsOpen: true, minParticipants: 20,
      modules: { draft: true, participants: true }
    });
    const inscritos = NOMBRES.map((nombre) => {
      const creado = database.createParticipant(evento.id, {
        discord_username: `${nombre}#d`, game_name: nombre
      });
      return database.updateParticipant(creado.id, { status: 'confirmed' });
    });
    database.valorant.configureDraft(evento.id, {
      captains: inscritos.slice(0, 4).map((p) => p.id), teamCount: 4, teamSize: 5
    });
    database.valorant.startDraft(evento.id);
    const cola = inscritos.slice(4).map((p) => p.id);
    while (cola.length) {
      const draft = database.valorant.getDraft(evento.id);
      const turno = database.valorant.teamForPick(evento.id, draft.currentPick);
      database.valorant.pick(evento.id, {
        captainParticipantId: turno.team.captainParticipantId,
        selectedParticipantId: cola.shift()
      });
    }
    const equipos = database.valorant.listTeams(evento.id);
    database.valorantCompetition.setMapPool(evento.id, ['bind']);
    database.valorantCompetition.generateRegularSeason(evento.id, equipos.map((e) => e.id));
    for (const serie of database.valorantCompetition.listSeries(evento.id)) {
      database.valorantCompetition.assignMap(evento.id, { seriesId: serie.id, mapKey: 'bind' });
    }
    return { database, evento, equipos };
  }

  /** Estadísticas de una partida, con el ACS que se le quiera dar a cada equipo. */
  function estadisticas(database, evento, serie, acsPorEquipo) {
    const equipos = database.valorant.listTeams(evento.id);
    return [serie.teamAId, serie.teamBId].flatMap((teamId) => {
      const equipo = equipos.find((e) => e.id === teamId);
      return equipo.members.map((miembro) => ({
        participantId: miembro.participantId,
        teamId,
        acs: acsPorEquipo[teamId],
        kills: 10, deaths: 10, assists: 5
      }));
    });
  }

  it('con todo empatado, va delante el equipo con mejor ACS', () => {
    const { database, evento, equipos } = ligaMontada();
    database.valorantCompetition.setSettings(evento.id, {
      tiebreakers: ['wins', 'round_diff', 'team_stats'], actor: 'prueba'
    });

    /*
      Se monta el ciclo de tres del que no sale el enfrentamiento directo:
      A gana a B, B gana a C, C gana a A, y los tres ganan a D. Todos 13-7,
      así que la diferencia de rondas tampoco separa a A, B y C.
    */
    const [A, B, C, D] = equipos.map((e) => e.id);
    const ganadores = new Map([
      [`${A}|${B}`, A], [`${B}|${C}`, B], [`${C}|${A}`, C],
      [`${A}|${D}`, A], [`${B}|${D}`, B], [`${C}|${D}`, C]
    ]);
    // ACS: A el mejor, luego C, luego B. Sin nada más que los separe, ése
    // debería ser el orden final entre los tres.
    const acs = { [A]: 260, [B]: 200, [C]: 230, [D]: 150 };

    for (const serie of database.valorantCompetition.listSeries(evento.id)) {
      const clave = [...ganadores.keys()].find((k) => {
        const [uno, otro] = k.split('|').map(Number);
        return (serie.teamAId === uno && serie.teamBId === otro)
          || (serie.teamAId === otro && serie.teamBId === uno);
      });
      const ganador = ganadores.get(clave);
      const ganaA = serie.teamAId === ganador;
      database.valorantCompetition.recordGameResult(evento.id, {
        seriesId: serie.id,
        teamARounds: ganaA ? 13 : 7,
        teamBRounds: ganaA ? 7 : 13,
        source: 'SCREENSHOT',
        stats: estadisticas(database, evento, serie, acs)
      });
    }

    const tabla = database.valorantCompetition.standings(evento.id, { teams: equipos });
    const orden = tabla.standings.map((fila) => fila.teamId);

    assert.deepEqual(orden.slice(0, 3), [A, C, B], 'ordenados por ACS medio');
    assert.equal(orden[3], D, 'el que perdió todo va último');
    assert.equal(tabla.tieRequiresAdmin, false,
      'con las estadísticas ya no hace falta que decida la organización');
  });

  it('sin estadísticas no se inventa un orden: sigue siendo empate', () => {
    const { database, evento, equipos } = ligaMontada();
    database.valorantCompetition.setSettings(evento.id, {
      tiebreakers: ['wins', 'round_diff', 'team_stats'], actor: 'prueba'
    });

    const [A, B, C, D] = equipos.map((e) => e.id);
    const ganadores = new Map([
      [`${A}|${B}`, A], [`${B}|${C}`, B], [`${C}|${A}`, C],
      [`${A}|${D}`, A], [`${B}|${D}`, B], [`${C}|${D}`, C]
    ]);

    // Todo a mano: los marcadores existen, las estadísticas no.
    for (const serie of database.valorantCompetition.listSeries(evento.id)) {
      const clave = [...ganadores.keys()].find((k) => {
        const [uno, otro] = k.split('|').map(Number);
        return (serie.teamAId === uno && serie.teamBId === otro)
          || (serie.teamAId === otro && serie.teamBId === uno);
      });
      const ganaA = serie.teamAId === ganadores.get(clave);
      database.valorantCompetition.recordGameResult(evento.id, {
        seriesId: serie.id,
        teamARounds: ganaA ? 13 : 7,
        teamBRounds: ganaA ? 7 : 13,
        reason: 'sin capturas'
      });
    }

    const tabla = database.valorantCompetition.standings(evento.id, { teams: equipos });
    assert.equal(tabla.tieRequiresAdmin, true,
      'sin datos que comparar el empate sigue ahí, y se dice');
  });

  it('las estadísticas van después de las victorias y las rondas, no antes', () => {
    const { database, evento, equipos } = ligaMontada();
    database.valorantCompetition.setSettings(evento.id, {
      tiebreakers: ['wins', 'round_diff', 'team_stats'], actor: 'prueba'
    });

    const [A, B, C, D] = equipos.map((e) => e.id);
    // A gana todo con marcadores ajustados y ACS bajo; B pierde con A pero
    // arrasa al resto con ACS altísimo. Las victorias mandan.
    const acs = { [A]: 150, [B]: 300, [C]: 200, [D]: 200 };
    const ganadores = new Map([
      [`${A}|${B}`, A], [`${A}|${C}`, A], [`${A}|${D}`, A],
      [`${B}|${C}`, B], [`${B}|${D}`, B], [`${C}|${D}`, C]
    ]);

    for (const serie of database.valorantCompetition.listSeries(evento.id)) {
      const clave = [...ganadores.keys()].find((k) => {
        const [uno, otro] = k.split('|').map(Number);
        return (serie.teamAId === uno && serie.teamBId === otro)
          || (serie.teamAId === otro && serie.teamBId === uno);
      });
      const ganaA = serie.teamAId === ganadores.get(clave);
      database.valorantCompetition.recordGameResult(evento.id, {
        seriesId: serie.id,
        teamARounds: ganaA ? 13 : 11,
        teamBRounds: ganaA ? 11 : 13,
        source: 'SCREENSHOT',
        stats: estadisticas(database, evento, serie, acs)
      });
    }

    const tabla = database.valorantCompetition.standings(evento.id, { teams: equipos });
    assert.equal(tabla.standings[0].teamId, A,
      'gana quien más partidos gana, por mucho ACS que tenga otro');
  });
});
