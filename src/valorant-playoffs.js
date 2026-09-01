'use strict';

/**
 * Las eliminatorias: generar el cuadro, moverlo y protegerlo.
 *
 * No hay un sistema paralelo al de la fase regular: un partido de playoffs es
 * una serie con sus partidas, exactamente igual. Lo que añade este módulo es
 * de dónde sale cada participante y qué pasa cuando una serie termina.
 *
 * Tres reglas sostienen todo:
 *
 * 1. Los emparejamientos los deriva el SERVIDOR de la clasificación. El
 *    navegador nunca manda quién es el primer clasificado.
 * 2. Un hueco vacío se queda vacío. Nunca se inventa un participante antes de
 *    que se sepa quién es.
 * 3. Una corrección que cambiaría un cuadro ya en marcha se BLOQUEA. Rehacerlo
 *    en silencio dejaría partidos jugados por equipos que no debían jugarlos.
 */

const {
  SLOTS, PLAN, INITIAL_SLOTS, planFor, dependents,
  seedPairings, lossesByTeam, standings: bracketStandings
} = require('./services/playoffs/bracket');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const STAGE = 'PLAYOFFS';

/** Cuántos mapas se juega cada ronda. La gran final tiene su propia regla. */
const DEFAULT_BEST_OF = 3;
const PLAYOFF_QUALIFIERS = 4;

/**
 * La gran final se gana por diferencia de DOS mapas: 2-0, 3-1, 4-2…
 *
 * Un 2-1 no cierra nada. Por eso no se sabe de antemano cuántas partidas hacen
 * falta y se van creando según se necesitan, en vez de nacer todas juntas.
 */
const GRAND_FINAL_WIN_BY = 2;

/**
 * Tope de seguridad.
 *
 * Una serie a dos de ventaja termina sola casi siempre —lo raro es pasar de
 * seis mapas—, pero «casi siempre» no es una garantía y un torneo no puede
 * quedarse esperando indefinidamente. Al llegar aquí sin diferencia de dos,
 * decide la organización, igual que con los empates que nada rompe.
 */
const GRAND_FINAL_MAX_GAMES = 9;

function unresolvedTieGroups(standings) {
  const groups = [];
  let current = [];
  for (const row of standings) {
    if (row.tieRequiresAdmin) {
      current.push(row);
    } else if (current.length) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

class PlayoffError extends Error {
  constructor(message, code = 'PLAYOFF_ERROR', status = 400) {
    super(message);
    this.name = 'PlayoffError';
    this.code = code;
    this.status = status;
  }
}

function createValorantPlayoffStore(connection, { audit, competition } = {}) {
  const registrar = audit || (() => {});

  const toSerie = (row) => row && {
    id: row.id,
    eventId: row.event_id,
    slot: row.bracket_slot,
    matchday: row.matchday,
    position: row.position,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    teamASeed: row.team_a_seed,
    teamBSeed: row.team_b_seed,
    bestOf: row.best_of,
    // Cuando está puesta, manda ella: la serie se gana por diferencia.
    winBy: row.win_by ?? null,
    status: row.status,
    winnerTeamId: row.winner_team_id
  };

  const store = {
    PlayoffError,
    STAGE,
    SLOTS,

    // ------------------------------------------------------- consulta

    listSeries(eventId) {
      const series = connection.prepare(
        'SELECT * FROM valorant_series WHERE event_id=? AND stage=? ORDER BY matchday, position'
      ).all(eventId, STAGE).map(toSerie);
      if (series.length === 0) return [];

      const juegos = connection.prepare(`
        SELECT g.* FROM valorant_games g
        JOIN valorant_series s ON s.id = g.series_id
        WHERE s.event_id=? AND s.stage=? ORDER BY g.game_number`).all(eventId, STAGE);

      return series.map((serie) => ({
        ...serie,
        plan: planFor(serie.slot),
        games: juegos.filter((juego) => juego.series_id === serie.id).map((juego) => ({
          id: juego.id,
          gameNumber: juego.game_number,
          mapKey: juego.map_key,
          teamARounds: juego.team_a_rounds,
          teamBRounds: juego.team_b_rounds,
          winnerTeamId: juego.winner_team_id,
          resultSource: juego.result_source,
          status: juego.status
        }))
      }));
    },

    exists(eventId) {
      return connection.prepare(
        'SELECT COUNT(*) total FROM valorant_series WHERE event_id=? AND stage=?'
      ).get(eventId, STAGE).total > 0;
    },

    getSeries(eventId, seriesId) {
      return this.listSeries(eventId).find((serie) => serie.id === Number(seriesId)) ?? null;
    },

    getSeriesBySlot(eventId, slot) {
      return this.listSeries(eventId).find((serie) => serie.slot === slot) ?? null;
    },

    /** Cuántos mapas se juega la gran final. */
    /**
     * Comprueba que la liga puede dar cuatro clasificados sin dudas.
     *
     * @returns {{ok: true, seeds: number[]} | {ok: false, code: string, message: string}}
     */
    seedsFromRegularSeason(eventId, teams) {
      const series = competition.listSeries(eventId, 'REGULAR');
      if (series.length === 0) {
        return { ok: false, code: 'REGULAR_SEASON_MISSING', message: 'No hay fase regular.' };
      }
      const pendientes = series.filter((serie) => serie.status !== 'COMPLETED');
      if (pendientes.length > 0) {
        return {
          ok: false, code: 'REGULAR_SEASON_INCOMPLETE',
          message: `Faltan ${pendientes.length} partidos de la fase regular por jugar.`
        };
      }

      const tabla = competition.standings(eventId, { teams });
      if (tabla.standings.length < 4) {
        return { ok: false, code: 'NOT_ENOUGH_TEAMS', message: 'Hacen falta al menos cuatro equipos.' };
      }

      /*
        ⚠️ Un empate que ningún criterio deshace no puede resolverse sembrando al
        azar: decide quién juega contra quién y hasta quién entra. Sólo importa
        si afecta a los cuatro primeros o a la frontera con el quinto; un empate
        entre el quinto y el sexto no cambia nada del cuadro.
      */
      const gruposSinResolver = unresolvedTieGroups(tabla.standings);
      const afectaClasificacion = gruposSinResolver.some((grupo) =>
        grupo.some((fila) => fila.position <= PLAYOFF_QUALIFIERS));
      if (afectaClasificacion) {
        return {
          ok: false, code: 'PLAYOFF_SEEDING_UNRESOLVED',
          message: 'Hay un empate sin resolver que afecta a los clasificados. Resuélvelo antes de generar el cuadro.'
        };
      }

      return { ok: true, seeds: tabla.standings.slice(0, 4).map((fila) => fila.teamId) };
    },

    /**
     * Monta el cuadro. Los emparejamientos salen de la clasificación, no de lo
     * que mande nadie desde fuera.
     */
    generate(eventId, teams, { actor = 'admin' } = {}) {
      if (this.exists(eventId)) {
        throw new PlayoffError(
          'La eliminatoria ya está generada.', 'PLAYOFFS_ALREADY_EXIST', 409);
      }

      const clasificados = this.seedsFromRegularSeason(eventId, teams);
      if (!clasificados.ok) {
        throw new PlayoffError(clasificados.message, clasificados.code, 409);
      }

      const emparejamientos = seedPairings(clasificados.seeds);

      const montar = connection.transaction(() => {
        const insertarSerie = connection.prepare(`
          INSERT INTO valorant_series
            (event_id, stage, matchday, position, bracket_slot,
             team_a_id, team_b_id, team_a_seed, team_b_seed, best_of, win_by, status)
          VALUES (@eventId, '${STAGE}', @matchday, @position, @slot,
                  @teamAId, @teamBId, @teamASeed, @teamBSeed, @bestOf, @winBy, 'PENDING')`);
        const insertarJuego = connection.prepare(
          "INSERT INTO valorant_games (series_id, game_number, status) VALUES (?,?,'PENDING')");

        for (const [indice, slot] of INITIAL_SLOTS.entries()) {
          const entrada = planFor(slot);
          const pareja = emparejamientos[slot];
          const esFinal = slot === SLOTS.GRAND_FINAL;
          /*
            La final nace con dos mapas: los mínimos para ganarla (2-0). Si se
            queda 1-1 aparecerá el tercero, y así hasta que alguien saque dos.
            Las demás series sí saben desde el principio cuántas partidas tienen.

            Ojo: los mapas que se crean y la columna `best_of` no son lo mismo
            aquí. `best_of` sólo admite 1, 3 o 5 y en una serie por ventaja no
            decide nada —manda `win_by`—, así que se deja el valor por defecto
            en vez de intentar meter un 2 que la base rechaza.
          */
          const mapas = esFinal ? GRAND_FINAL_WIN_BY : DEFAULT_BEST_OF;

          const info = insertarSerie.run({
            eventId,
            matchday: entrada.round,
            position: indice + 1,
            slot,
            // Los huecos que dependen de otra serie nacen vacíos a propósito.
            teamAId: pareja?.a ?? null,
            teamBId: pareja?.b ?? null,
            teamASeed: pareja?.seedA ?? null,
            teamBSeed: pareja?.seedB ?? null,
            bestOf: DEFAULT_BEST_OF,
            winBy: esFinal ? GRAND_FINAL_WIN_BY : null
          });

          for (let numero = 1; numero <= mapas; numero++) {
            insertarJuego.run(Number(info.lastInsertRowid), numero);
          }
        }
      });
      montar();

      registrar(eventId, actor, 'PLAYOFFS_GENERATED', null, null, {
        seeds: clasificados.seeds, grandFinalWinBy: GRAND_FINAL_WIN_BY
      });
      return this.listSeries(eventId);
    },

    // ------------------------------------------------------ propagación

    /**
     * Lleva ganadores y perdedores a las series que dependen de ellos.
     *
     * Va dentro de la transacción de quien la llama: si el resultado no entra,
     * el cuadro tampoco se mueve.
     */
    propagate(eventId, { actor = 'admin' } = {}) {
      const series = this.listSeries(eventId);
      const porSlot = new Map(series.map((serie) => [serie.slot, serie]));
      const movimientos = [];

      const ponerEn = (slot, lado, teamId) => {
        const destino = porSlot.get(slot);
        if (!destino || !teamId) return;
        const columna = lado === 'a' ? 'team_a_id' : 'team_b_id';
        const propiedad = lado === 'a' ? 'teamAId' : 'teamBId';
        const actual = destino[propiedad];
        if (actual === teamId) return;
        if (actual !== null && actual !== undefined) {
          throw new PlayoffError(
            `El hueco ${slot}.${lado} ya pertenece a otro equipo.`,
            'BRACKET_SLOT_CONFLICT', 409);
        }

        connection.prepare(
          `UPDATE valorant_series SET ${columna}=?, updated_at=${NOW} WHERE id=?`)
          .run(teamId, destino.id);
        destino[propiedad] = teamId;
        movimientos.push({ slot, side: lado, teamId });
      };

      for (const serie of series) {
        if (serie.status !== 'COMPLETED' || !serie.winnerTeamId) continue;
        const perdedor = serie.winnerTeamId === serie.teamAId ? serie.teamBId : serie.teamAId;

        for (const destino of dependents(serie.slot)) {
          ponerEn(destino.slot, destino.side,
            destino.take === 'winner' ? serie.winnerTeamId : perdedor);
        }
      }

      // Una serie con sus dos equipos puestos ya se puede jugar.
      connection.prepare(`
        UPDATE valorant_series SET status='READY', updated_at=${NOW}
        WHERE event_id=? AND stage=? AND status='PENDING'
          AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL`).run(eventId, STAGE);

      if (movimientos.length) {
        registrar(eventId, actor, 'PLAYOFF_BRACKET_ADVANCED', null, null, { movimientos });
      }
      return movimientos;
    },

    /**
     * Añade el siguiente mapa de una serie por ventaja que sigue viva.
     *
     * Se llama después de cerrar cada partida. En una serie normal no hace
     * nada: sus mapas nacieron todos con ella. En la final, si nadie ha sacado
     * dos de ventaja y ya no quedan mapas por jugar, crea el siguiente.
     */
    ensureNextFinalGame(eventId, seriesId) {
      const serie = connection.prepare(
        'SELECT * FROM valorant_series WHERE id=? AND event_id=?').get(seriesId, eventId);
      if (!serie || !serie.win_by || serie.status === 'COMPLETED') return null;

      const juegos = connection.prepare(
        'SELECT status FROM valorant_games WHERE series_id=?').all(seriesId);
      // Mientras quede alguno sin jugar, no hace falta inventar otro.
      if (juegos.some((juego) => juego.status === 'PENDING')) return null;

      if (juegos.length >= GRAND_FINAL_MAX_GAMES) {
        connection.prepare(
          `UPDATE valorant_series SET status='REVIEW_REQUIRED', updated_at=${NOW} WHERE id=?`
        ).run(seriesId);
        registrar(eventId, 'sistema', 'PLAYOFF_FINAL_UNRESOLVED', `series:${seriesId}`, null, {
          reason: `la final ha llegado a ${juegos.length} mapas sin diferencia de ${serie.win_by}`
        });
        return null;
      }

      const numero = juegos.length + 1;
      connection.prepare(
        "INSERT INTO valorant_games (series_id, game_number, status) VALUES (?,?,'PENDING')"
      ).run(seriesId, numero);
      registrar(eventId, 'sistema', 'PLAYOFF_FINAL_GAME_ADDED', `series:${seriesId}`, null, {
        gameNumber: numero, reason: 'la final sigue sin diferencia de dos mapas'
      });
      return numero;
    },

    // ------------------------------------------------- dependencias

    /**
     * Qué series dependen de ésta y ya han empezado a jugarse.
     *
     * Se usa antes de permitir una corrección: si el cuadro ha avanzado sobre
     * un resultado, cambiarlo dejaría partidos jugados por equipos que nunca
     * debieron llegar ahí.
     */
    startedDependents(eventId, slot, { visitados = new Set() } = {}) {
      if (visitados.has(slot)) return [];
      visitados.add(slot);

      const series = this.listSeries(eventId);
      const porSlot = new Map(series.map((serie) => [serie.slot, serie]));
      const iniciadas = [];

      for (const destino of dependents(slot)) {
        const serie = porSlot.get(destino.slot);
        if (!serie) continue;

        const empezada = serie.status === 'COMPLETED'
          || serie.games.some((juego) => juego.status === 'COMPLETED');
        if (empezada) iniciadas.push(serie);

        iniciadas.push(...this.startedDependents(eventId, destino.slot, { visitados }));
      }
      return iniciadas;
    },

    /**
     * Deja vacíos los huecos que colgaban de una serie cuyo resultado cambia.
     *
     * Sólo se llama cuando ya se ha comprobado que ninguno había empezado.
     */
    clearDownstream(eventId, slot, { visitados = new Set() } = {}) {
      if (visitados.has(slot)) return;
      visitados.add(slot);

      const porSlot = new Map(this.listSeries(eventId).map((serie) => [serie.slot, serie]));
      for (const destino of dependents(slot)) {
        const serie = porSlot.get(destino.slot);
        if (!serie) continue;

        const columna = destino.side === 'a' ? 'team_a_id' : 'team_b_id';
        connection.prepare(
          `UPDATE valorant_series SET ${columna}=NULL, status='PENDING', winner_team_id=NULL,
           updated_at=${NOW} WHERE id=?`).run(serie.id);

        this.clearDownstream(eventId, destino.slot, { visitados });
      }
    },

    // --------------------------------------------------------- estado

    /** Marca como no necesarias las partidas que ya no se van a jugar. */
    markUnneededGames(eventId) {
      connection.prepare(`
        UPDATE valorant_games SET status='NOT_NEEDED', updated_at=${NOW}
        WHERE status='PENDING' AND series_id IN (
          SELECT id FROM valorant_series
          WHERE event_id=? AND stage=? AND status='COMPLETED')`).run(eventId, STAGE);
    },

    /** Cómo va el cuadro: quién sigue vivo, quién fuera y quién ha ganado. */
    standings(eventId) {
      return bracketStandings(this.listSeries(eventId));
    },

    losses(eventId) {
      return lossesByTeam(this.listSeries(eventId));
    },

    /** Lo que se puede enseñar a cualquiera. */
    publicState(eventId, teams = []) {
      const nombre = new Map(teams.map((equipo) => [equipo.id, equipo.name]));
      const series = this.listSeries(eventId);
      if (series.length === 0) return { generated: false, series: [], placements: [], status: 'PENDING' };

      const tabla = this.standings(eventId);
      const equipo = (teamId, seed) => teamId
        ? { teamId, name: nombre.get(teamId) ?? null, seed: seed ?? null }
        : null;

      return {
        generated: true,
        status: tabla.status,
        champion: tabla.champion,
        runnerUp: tabla.runnerUp,
        placements: tabla.placements.map((fila) => ({
          ...fila, name: nombre.get(fila.teamId) ?? null
        })),
        series: series.map((serie) => ({
          id: serie.id,
          slot: serie.slot,
          label: serie.plan?.label ?? serie.slot,
          bracket: serie.plan?.bracket ?? null,
          round: serie.matchday,
          bestOf: serie.bestOf,
          status: serie.status,
          scheduledAt: serie.scheduledAt,
          // Vacío mientras no se sepa: nunca un participante inventado.
          teamA: equipo(serie.teamAId, serie.teamASeed),
          teamB: equipo(serie.teamBId, serie.teamBSeed),
          winnerTeamId: serie.winnerTeamId,
          // El marcador de la SERIE son mapas ganados, no rondas.
          seriesScore: contarMapas(serie),
          games: serie.games.map((juego) => ({
            gameNumber: juego.gameNumber,
            mapKey: juego.mapKey,
            teamARounds: juego.teamARounds,
            teamBRounds: juego.teamBRounds,
            status: juego.status,
            verifiedByCapture: juego.resultSource === 'SCREENSHOT',
            stats: juego.status === 'COMPLETED'
              ? competition.listGameStats(juego.id).map((fila) => ({
                participantId: fila.participantId,
                teamId: fila.teamId,
                agent: fila.agent,
                acs: fila.acs, kills: fila.kills, deaths: fila.deaths, assists: fila.assists,
                plusMinus: fila.plusMinus, adr: fila.adr,
                hsPercent: fila.hsPercent, kastPercent: fila.kastPercent,
                firstKills: fila.firstKills, firstDeaths: fila.firstDeaths
              }))
              : []
          }))
        }))
      };
    }
  };

  return store;
}

/** Mapas ganados por cada lado de la serie. */
function contarMapas(serie) {
  let a = 0;
  let b = 0;
  for (const juego of serie.games) {
    if (juego.status !== 'COMPLETED' || !juego.winnerTeamId) continue;
    if (juego.winnerTeamId === serie.teamAId) a += 1;
    else if (juego.winnerTeamId === serie.teamBId) b += 1;
  }
  return { a, b };
}

module.exports = {
  createValorantPlayoffStore, PlayoffError,
  STAGE, SLOTS, PLAN, DEFAULT_BEST_OF,
  GRAND_FINAL_WIN_BY, GRAND_FINAL_MAX_GAMES
};
