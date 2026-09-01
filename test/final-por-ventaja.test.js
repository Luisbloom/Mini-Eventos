'use strict';

/**
 * La gran final se gana por diferencia de dos mapas.
 *
 * No es un BO3: un 2-1 no cierra nada. Gana quien saque dos —2-0, 3-1, 4-2—, y
 * por eso esta serie es la única que no sabe de antemano cuántas partidas va a
 * tener: se crean según hacen falta.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/database');
const { SLOTS } = require('../src/services/playoffs/bracket');
const { GRAND_FINAL_WIN_BY, GRAND_FINAL_MAX_GAMES } = require('../src/valorant-playoffs');

describe('la final por ventaja de dos', () => {
  const directorios = [];
  const bases = [];
  const rutaTemporal = () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-final-'));
    directorios.push(carpeta);
    return path.join(carpeta, 'tournament.db');
  };
  afterEach(() => {
    bases.splice(0).forEach((base) => base.close());
    directorios.splice(0).forEach((carpeta) => fs.rmSync(carpeta, { recursive: true, force: true }));
  });

  const MAPAS = ['ascent', 'bind', 'haven', 'lotus', 'split', 'icebox', 'breeze', 'sunset', 'abyss'];

  /** Un torneo de 20 jugadores con la liga jugada y el cuadro montado. */
  function hastaElCuadro() {
    const database = openDatabase(rutaTemporal());
    bases.push(database);
    const evento = database.createEvent({
      slug: 'final-ventaja', name: 'Jartiland Valorant Cup', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      minParticipants: 20, modules: { draft: true, participants: true, competition: true }
    });
    const inscritos = Array.from({ length: 20 }, (_, i) => {
      const creado = database.createParticipant(evento.id, {
        discord_username: `p${i}`, game_name: `J${i}`
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
    database.valorantCompetition.setMapPool(evento.id, MAPAS);
    database.valorantCompetition.generateRegularSeason(evento.id, equipos.map((e) => e.id));
    for (const serie of database.valorantCompetition.listSeries(evento.id)) {
      database.valorantCompetition.assignMap(evento.id, { seriesId: serie.id, mapKey: 'ascent' });
      database.valorantCompetition.recordGameResult(evento.id, {
        seriesId: serie.id, teamARounds: 13, teamBRounds: 8, reason: 'liga'
      });
    }
    database.valorantPlayoffs.generate(evento.id, equipos);
    return { database, evento };
  }

  const dame = (database, evento, slot) =>
    database.valorantPlayoffs.getSeriesBySlot(evento.id, slot);

  /** Gana una serie normal a lo bruto, para llegar a la final. */
  function resolver(database, evento, slot, cual = 'a') {
    const serie = dame(database, evento, slot);
    for (let numero = 1; numero <= serie.bestOf; numero += 1) {
      const actual = database.valorantPlayoffs.getSeries(evento.id, serie.id);
      if (actual.status === 'COMPLETED') break;
      database.valorantCompetition.assignMap(evento.id, {
        seriesId: serie.id, gameNumber: numero, mapKey: MAPAS[numero - 1]
      });
      database.valorantCompetition.recordGameResult(evento.id, {
        seriesId: serie.id, gameNumber: numero,
        teamARounds: cual === 'a' ? 13 : 5, teamBRounds: cual === 'a' ? 5 : 13,
        reason: 'eliminatoria'
      });
    }
    return dame(database, evento, slot);
  }

  /** Deja el torneo con la gran final lista para jugarse. */
  function hastaLaFinal() {
    const { database, evento } = hastaElCuadro();
    for (const slot of [SLOTS.UPPER_SEMI_1, SLOTS.UPPER_SEMI_2,
      SLOTS.LOWER_ROUND_1, SLOTS.UPPER_FINAL, SLOTS.LOWER_FINAL]) {
      resolver(database, evento, slot);
    }
    return { database, evento, final: dame(database, evento, SLOTS.GRAND_FINAL) };
  }

  /** Anota un mapa de la final para el equipo que se diga. */
  function mapa(database, evento, final, numero, cual) {
    database.valorantCompetition.assignMap(evento.id, {
      seriesId: final.id, gameNumber: numero, mapKey: MAPAS[numero - 1]
    });
    database.valorantCompetition.recordGameResult(evento.id, {
      seriesId: final.id, gameNumber: numero,
      teamARounds: cual === 'a' ? 13 : 7, teamBRounds: cual === 'a' ? 7 : 13,
      reason: `mapa ${numero} de la final`
    });
    return database.valorantPlayoffs.getSeries(evento.id, final.id);
  }

  it('nace con dos mapas y su propia regla', () => {
    const { database, evento, final } = hastaLaFinal();
    assert.equal(final.winBy, GRAND_FINAL_WIN_BY);
    assert.equal(final.games.length, 2, 'los mínimos para ganarla');
    // Las demás series no llevan la regla: son al mejor de tres.
    assert.equal(dame(database, evento, SLOTS.UPPER_FINAL).winBy, null);
  });

  it('un 2-0 la cierra', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'a');
    const despues = mapa(database, evento, final, 2, 'a');
    assert.equal(despues.status, 'COMPLETED');
    assert.equal(despues.winnerTeamId, final.teamAId);
    assert.equal(despues.games.length, 2, 'no hace falta un tercero');
  });

  it('un 1-1 NO la cierra, y aparece un tercer mapa', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'a');
    const empatada = mapa(database, evento, final, 2, 'b');
    assert.notEqual(empatada.status, 'COMPLETED');
    assert.equal(empatada.winnerTeamId, null);
    // Aquí está la diferencia con un BO3: se sigue jugando.
    assert.equal(empatada.games.length, 3, 'la final se alarga sola');
  });

  it('un 2-1 tampoco: hacen falta dos de ventaja', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'a');
    mapa(database, evento, final, 2, 'b');
    const dosAUno = mapa(database, evento, final, 3, 'a');
    assert.notEqual(dosAUno.status, 'COMPLETED', 'un 2-1 no es campeón');
    assert.equal(dosAUno.games.length, 4);
  });

  it('un 3-1 sí la cierra', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'a');
    mapa(database, evento, final, 2, 'b');
    mapa(database, evento, final, 3, 'a');
    const tresAUno = mapa(database, evento, final, 4, 'a');
    assert.equal(tresAUno.status, 'COMPLETED');
    assert.equal(tresAUno.winnerTeamId, final.teamAId);
  });

  it('y también la puede ganar el que iba perdiendo', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'a');   // 1-0
    mapa(database, evento, final, 2, 'b');   // 1-1
    mapa(database, evento, final, 3, 'b');   // 1-2
    const remontada = mapa(database, evento, final, 4, 'b');   // 1-3
    assert.equal(remontada.status, 'COMPLETED');
    assert.equal(remontada.winnerTeamId, final.teamBId);
  });

  it('el campeón sale de la final, sin repetirla', () => {
    const { database, evento, final } = hastaLaFinal();
    mapa(database, evento, final, 1, 'b');
    mapa(database, evento, final, 2, 'b');
    const tabla = database.valorantPlayoffs.standings(evento.id);
    assert.equal(tabla.status, 'COMPLETED');
    assert.equal(tabla.champion, final.teamBId);
    // Antes, ganar viniendo del cuadro bajo obligaba a una segunda final.
    assert.ok(!dame(database, evento, 'GRAND_FINAL_RESET'));
  });

  it('tiene un tope: no puede alargarse para siempre', () => {
    const { database, evento, final } = hastaLaFinal();
    // Se van alternando: nadie saca nunca dos de ventaja.
    let numero = 1;
    let serie = final;
    while (serie.games.length > serie.games.filter((j) => j.status === 'COMPLETED').length
      && numero <= GRAND_FINAL_MAX_GAMES) {
      serie = mapa(database, evento, final, numero, numero % 2 ? 'a' : 'b');
      numero += 1;
    }
    assert.ok(serie.games.length <= GRAND_FINAL_MAX_GAMES,
      `no puede pasar de ${GRAND_FINAL_MAX_GAMES} mapas`);
    assert.equal(serie.status, 'REVIEW_REQUIRED',
      'al llegar al tope decide la organización, como con los empates');
  });
});
