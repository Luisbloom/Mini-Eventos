'use strict';

const { roundRobinSchedule, scheduleSummary } = require('./services/round-robin');

/**
 * Fase regular de un torneo por equipos: calendario, mapas, resultados y
 * clasificación.
 *
 * Serie y partida son cosas distintas desde el principio. Un BO1 es una serie
 * con una partida; un BO3, la misma serie con tres. Modelarlo al revés obliga a
 * rehacerlo entero cuando llegan los playoffs, y llegan siempre.
 *
 * La clasificación no se guarda: se calcula de los resultados. Una tabla que se
 * puede derivar y además se almacena acaba discrepando de sus propios datos.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const SERIES_STATUSES = Object.freeze(['PENDING', 'READY', 'WAITING_RESULT', 'COMPLETED', 'REVIEW_REQUIRED']);
const GAME_STATUSES = Object.freeze(['PENDING', 'WAITING_RESULT', 'COMPLETED', 'REVIEW_REQUIRED']);

/**
 * De dónde salió un resultado. La vía principal de este torneo será la captura;
 * el resto existe para no encerrarnos.
 */
const RESULT_SOURCES = Object.freeze(['SCREENSHOT', 'MANUAL', 'RIOT', 'HENRIK']);

/** Catálogo de partida. La organización decide cuáles se juegan. */
const DEFAULT_MAP_POOL = Object.freeze([
  { key: 'ascent', name: 'Ascent' },
  { key: 'bind', name: 'Bind' },
  { key: 'breeze', name: 'Breeze' },
  { key: 'fracture', name: 'Fracture' },
  { key: 'haven', name: 'Haven' },
  { key: 'icebox', name: 'Icebox' },
  { key: 'lotus', name: 'Lotus' },
  { key: 'pearl', name: 'Pearl' },
  { key: 'split', name: 'Split' },
  { key: 'sunset', name: 'Sunset' },
  { key: 'abyss', name: 'Abyss' }
]);

/** Criterios de desempate que la organización puede ordenar como quiera. */
const TIEBREAKERS = Object.freeze(['wins', 'head_to_head', 'round_diff', 'rounds_for']);
const DEFAULT_TIEBREAKERS = Object.freeze(['wins', 'head_to_head', 'round_diff', 'rounds_for']);

class CompetitionError extends Error {
  constructor(message, code = 'VALORANT_COMPETITION_ERROR', status = 400) {
    super(message);
    this.name = 'ValorantCompetitionError';
    this.code = code;
    this.status = status;
  }
}

function migrateValorantCompetition(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS valorant_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      map_key TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(event_id, map_key),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS valorant_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'REGULAR',
      matchday INTEGER NOT NULL,
      position INTEGER NOT NULL,
      team_a_id INTEGER NOT NULL,
      team_b_id INTEGER NOT NULL,
      best_of INTEGER NOT NULL DEFAULT 1 CHECK (best_of IN (1,3,5)),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','READY','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED')),
      winner_team_id INTEGER,
      scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      CHECK (team_a_id != team_b_id),
      UNIQUE(event_id, stage, matchday, position),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(team_a_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(team_b_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_series_event_stage ON valorant_series(event_id, stage, matchday);

    CREATE TABLE IF NOT EXISTS valorant_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      game_number INTEGER NOT NULL,
      map_key TEXT,
      team_a_rounds INTEGER,
      team_b_rounds INTEGER,
      winner_team_id INTEGER,
      result_source TEXT CHECK (result_source IN ('SCREENSHOT','MANUAL','RIOT','HENRIK')),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED')),
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(series_id, game_number),
      FOREIGN KEY(series_id) REFERENCES valorant_series(id) ON DELETE CASCADE,
      FOREIGN KEY(winner_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS valorant_settings (
      event_id INTEGER PRIMARY KEY,
      tiebreakers_json TEXT NOT NULL DEFAULT '["wins","head_to_head","round_diff","rounds_for"]',
      qualifiers INTEGER NOT NULL DEFAULT 4,
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
  `);
}

function createValorantCompetitionStore(connection, { audit } = {}) {
  const registrar = audit || (() => {});

  const toSeries = (row) => row && {
    id: row.id,
    eventId: row.event_id,
    stage: row.stage,
    matchday: row.matchday,
    position: row.position,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    bestOf: row.best_of,
    status: row.status,
    winnerTeamId: row.winner_team_id,
    scheduledAt: row.scheduled_at
  };

  const toGame = (row) => row && {
    id: row.id,
    seriesId: row.series_id,
    gameNumber: row.game_number,
    mapKey: row.map_key,
    teamARounds: row.team_a_rounds,
    teamBRounds: row.team_b_rounds,
    winnerTeamId: row.winner_team_id,
    resultSource: row.result_source,
    status: row.status
  };

  const store = {
    CompetitionError,
    RESULT_SOURCES,
    TIEBREAKERS,
    DEFAULT_MAP_POOL,

    // -------------------------------------------------------- mapas

    /** Siembra el catálogo la primera vez y devuelve el pool del evento. */
    listMaps(eventId) {
      const existentes = connection.prepare(
        'SELECT * FROM valorant_maps WHERE event_id=? ORDER BY position, id').all(eventId);
      if (existentes.length > 0) {
        return existentes.map((row) => ({
          key: row.map_key, name: row.name, enabled: Boolean(row.enabled)
        }));
      }

      const sembrar = connection.transaction(() => {
        const insertar = connection.prepare(
          'INSERT OR IGNORE INTO valorant_maps (event_id,map_key,name,enabled,position) VALUES (?,?,?,1,?)');
        DEFAULT_MAP_POOL.forEach((mapa, indice) => insertar.run(eventId, mapa.key, mapa.name, indice + 1));
      });
      sembrar();
      return this.listMaps(eventId);
    },

    /** La organización decide qué mapas se juegan en este torneo. */
    setMapPool(eventId, enabledKeys, { actor = 'admin' } = {}) {
      const activos = new Set((enabledKeys || []).map((clave) => String(clave).trim().toLowerCase()));
      if (activos.size === 0) {
        throw new CompetitionError('Deja al menos un mapa habilitado.', 'EMPTY_MAP_POOL');
      }
      this.listMaps(eventId);   // asegura el catálogo

      const guardar = connection.transaction(() => {
        const conocidos = connection.prepare('SELECT map_key FROM valorant_maps WHERE event_id=?')
          .all(eventId).map((row) => row.map_key);
        for (const clave of activos) {
          if (!conocidos.includes(clave)) {
            throw new CompetitionError(`El mapa ${clave} no está en el catálogo.`, 'UNKNOWN_MAP');
          }
        }
        connection.prepare('UPDATE valorant_maps SET enabled=0 WHERE event_id=?').run(eventId);
        const encender = connection.prepare('UPDATE valorant_maps SET enabled=1 WHERE event_id=? AND map_key=?');
        for (const clave of activos) encender.run(eventId, clave);
      });
      guardar();
      registrar(eventId, actor, 'MAP_POOL_UPDATED', null, null, { enabled: [...activos] });
      return this.listMaps(eventId);
    },

    enabledMapKeys(eventId) {
      return this.listMaps(eventId).filter((mapa) => mapa.enabled).map((mapa) => mapa.key);
    },

    // ---------------------------------------------------- fase regular

    getSettings(eventId) {
      const row = connection.prepare('SELECT * FROM valorant_settings WHERE event_id=?').get(eventId);
      if (!row) {
        return { tiebreakers: [...DEFAULT_TIEBREAKERS], qualifiers: 4 };
      }
      return { tiebreakers: JSON.parse(row.tiebreakers_json), qualifiers: row.qualifiers };
    },

    setSettings(eventId, { tiebreakers, qualifiers, actor = 'admin' } = {}) {
      const criterios = (tiebreakers || DEFAULT_TIEBREAKERS).map(String);
      for (const criterio of criterios) {
        if (!TIEBREAKERS.includes(criterio)) {
          throw new CompetitionError(`Criterio de desempate desconocido: ${criterio}.`, 'UNKNOWN_TIEBREAKER');
        }
      }
      const clasifican = Number(qualifiers ?? 4);
      connection.prepare(`
        INSERT INTO valorant_settings (event_id,tiebreakers_json,qualifiers) VALUES (?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET
          tiebreakers_json=excluded.tiebreakers_json, qualifiers=excluded.qualifiers, updated_at=${NOW}
      `).run(eventId, JSON.stringify(criterios), clasifican);
      registrar(eventId, actor, 'COMPETITION_SETTINGS_UPDATED', null, null, { tiebreakers: criterios, qualifiers: clasifican });
      return this.getSettings(eventId);
    },

    listSeries(eventId, stage = 'REGULAR') {
      const series = connection.prepare(
        'SELECT * FROM valorant_series WHERE event_id=? AND stage=? ORDER BY matchday, position'
      ).all(eventId, stage).map(toSeries);

      if (series.length === 0) return [];
      const juegos = connection.prepare(`
        SELECT g.* FROM valorant_games g
        JOIN valorant_series s ON s.id = g.series_id
        WHERE s.event_id=? AND s.stage=? ORDER BY g.game_number`).all(eventId, stage).map(toGame);

      return series.map((serie) => ({
        ...serie,
        games: juegos.filter((juego) => juego.seriesId === serie.id)
      }));
    },

    hasRegularSeason(eventId) {
      return connection.prepare(
        "SELECT COUNT(*) total FROM valorant_series WHERE event_id=? AND stage='REGULAR'"
      ).get(eventId).total > 0;
    },

    /**
     * Crea el calendario. `force` existe para rehacerlo si algo salió mal, pero
     * borra resultados: por eso hay que pedirlo a propósito.
     */
    generateRegularSeason(eventId, teamIds, { bestOf = 1, force = false, actor = 'admin', reason = null } = {}) {
      if (this.hasRegularSeason(eventId) && !force) {
        throw new CompetitionError(
          'La fase regular ya está generada. Para rehacerla hay que pedirlo expresamente.',
          'REGULAR_SEASON_EXISTS', 409);
      }
      if (!Array.isArray(teamIds) || teamIds.length < 2) {
        throw new CompetitionError('Hacen falta al menos dos equipos.', 'NOT_ENOUGH_TEAMS');
      }

      const calendario = roundRobinSchedule(teamIds);

      const generar = connection.transaction(() => {
        if (force) {
          connection.prepare("DELETE FROM valorant_series WHERE event_id=? AND stage='REGULAR'").run(eventId);
        }
        const insertarSerie = connection.prepare(`
          INSERT INTO valorant_series (event_id,stage,matchday,position,team_a_id,team_b_id,best_of,status)
          VALUES (?, 'REGULAR', ?, ?, ?, ?, ?, 'PENDING')`);
        const insertarJuego = connection.prepare(
          "INSERT INTO valorant_games (series_id,game_number,status) VALUES (?,?,'PENDING')");

        for (const jornada of calendario) {
          jornada.matches.forEach((partido, indice) => {
            const info = insertarSerie.run(
              eventId, jornada.matchday, indice + 1, partido.home, partido.away, bestOf);
            // Un BO1 es una serie con una partida. La estructura es la misma
            // que necesitará un BO3, sin tocar nada.
            for (let numero = 1; numero <= bestOf; numero++) {
              insertarJuego.run(Number(info.lastInsertRowid), numero);
            }
          });
        }
      });
      generar();

      registrar(eventId, actor, force ? 'REGULAR_SEASON_REGENERATED' : 'REGULAR_SEASON_GENERATED',
        null, reason, { teams: teamIds.length, ...scheduleSummary(teamIds.length) });
      return this.listSeries(eventId);
    },

    /** Los descansos no son partidos, así que se calculan al mostrar. */
    matchdays(eventId, stage = 'REGULAR') {
      const series = this.listSeries(eventId, stage);
      const equipos = new Set(series.flatMap((s) => [s.teamAId, s.teamBId]));
      const jornadas = [...new Set(series.map((s) => s.matchday))].sort((a, b) => a - b);

      return jornadas.map((matchday) => {
        const dela = series.filter((s) => s.matchday === matchday);
        const juegan = new Set(dela.flatMap((s) => [s.teamAId, s.teamBId]));
        const descansa = [...equipos].find((id) => !juegan.has(id)) ?? null;
        return { matchday, series: dela, bye: descansa };
      });
    },

    // -------------------------------------------------------- mapas por serie

    assignMap(eventId, { seriesId, gameNumber = 1, mapKey, actor = 'admin' }) {
      const serie = connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
        .get(seriesId, eventId);
      if (!serie) throw new CompetitionError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

      const clave = String(mapKey || '').trim().toLowerCase();
      if (!this.enabledMapKeys(eventId).includes(clave)) {
        throw new CompetitionError(
          'Ese mapa no está habilitado para este torneo.', 'MAP_NOT_ENABLED');
      }

      const cambio = connection.prepare(
        `UPDATE valorant_games SET map_key=?, status=CASE WHEN status='PENDING' THEN 'WAITING_RESULT' ELSE status END,
         updated_at=${NOW} WHERE series_id=? AND game_number=?`).run(clave, seriesId, gameNumber);
      if (!cambio.changes) throw new CompetitionError('Esa partida no existe.', 'GAME_NOT_FOUND', 404);

      // Con todos los mapas puestos la serie ya se puede jugar.
      const sinMapa = connection.prepare(
        'SELECT COUNT(*) total FROM valorant_games WHERE series_id=? AND map_key IS NULL').get(seriesId).total;
      if (sinMapa === 0 && serie.status === 'PENDING') {
        connection.prepare(`UPDATE valorant_series SET status='READY', updated_at=${NOW} WHERE id=?`).run(seriesId);
      }

      registrar(eventId, actor, 'MAP_ASSIGNED', `series:${seriesId}`, null, { gameNumber, mapKey: clave });
      return this.getSeries(eventId, seriesId);
    },

    getSeries(eventId, seriesId) {
      const serie = toSeries(connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
        .get(seriesId, eventId));
      if (!serie) return null;
      serie.games = connection.prepare(
        'SELECT * FROM valorant_games WHERE series_id=? ORDER BY game_number').all(seriesId).map(toGame);
      return serie;
    },

    // ---------------------------------------------------------- resultados

    /**
     * Guarda el resultado de una partida. El ganador lo decide el servidor a
     * partir de las rondas: aceptar un ganador del cliente permitiría registrar
     * un 13-8 perdido.
     */
    recordGameResult(eventId, { seriesId, gameNumber = 1, teamARounds, teamBRounds, source = 'MANUAL', reason = null, actor = 'admin', allowOverwrite = false }) {
      if (!RESULT_SOURCES.includes(source)) {
        throw new CompetitionError('Origen de resultado desconocido.', 'UNKNOWN_RESULT_SOURCE');
      }
      const a = Number(teamARounds);
      const b = Number(teamBRounds);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
        throw new CompetitionError('Las rondas deben ser números enteros.', 'INVALID_ROUNDS');
      }
      if (a === b) {
        throw new CompetitionError('Una partida de Valorant no acaba en empate.', 'INVALID_ROUNDS');
      }
      if (!reason || !String(reason).trim()) {
        throw new CompetitionError('Hace falta un motivo.', 'REASON_REQUIRED');
      }

      const guardar = connection.transaction(() => {
        const serie = connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
          .get(seriesId, eventId);
        if (!serie) throw new CompetitionError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

        const juego = connection.prepare('SELECT * FROM valorant_games WHERE series_id=? AND game_number=?')
          .get(seriesId, gameNumber);
        if (!juego) throw new CompetitionError('Esa partida no existe.', 'GAME_NOT_FOUND', 404);

        // No se pisa un resultado cerrado por accidente: corregir es otra acción.
        if (juego.status === 'COMPLETED' && !allowOverwrite) {
          throw new CompetitionError(
            'Esa partida ya tiene resultado. Para cambiarlo hay que corregirlo expresamente.',
            'RESULT_ALREADY_RECORDED', 409);
        }

        const ganador = a > b ? serie.team_a_id : serie.team_b_id;
        connection.prepare(`
          UPDATE valorant_games
          SET team_a_rounds=?, team_b_rounds=?, winner_team_id=?, result_source=?,
              status='COMPLETED', updated_at=${NOW}
          WHERE id=?`).run(a, b, ganador, source, juego.id);

        // La serie se cierra cuando alguien llega a los mapas necesarios.
        const necesarios = Math.floor(serie.best_of / 2) + 1;
        const ganados = connection.prepare(
          "SELECT winner_team_id id, COUNT(*) total FROM valorant_games WHERE series_id=? AND status='COMPLETED' GROUP BY winner_team_id"
        ).all(seriesId);
        const campeon = ganados.find((fila) => fila.total >= necesarios);
        if (campeon) {
          connection.prepare(
            `UPDATE valorant_series SET status='COMPLETED', winner_team_id=?, updated_at=${NOW} WHERE id=?`
          ).run(campeon.id, seriesId);
        } else {
          connection.prepare(
            `UPDATE valorant_series SET status='WAITING_RESULT', updated_at=${NOW} WHERE id=?`
          ).run(seriesId);
        }
        return ganador;
      });

      const ganador = guardar();
      registrar(eventId, actor, allowOverwrite ? 'RESULT_CORRECTED' : 'RESULT_RECORDED',
        `series:${seriesId}`, reason, { gameNumber, teamARounds: a, teamBRounds: b, source, winnerTeamId: ganador });
      return this.getSeries(eventId, seriesId);
    },

    // -------------------------------------------------------- clasificación

    /**
     * Se calcula de los resultados, no se guarda. Una tabla derivable que además
     * se almacena acaba discrepando de sus propios datos.
     */
    standings(eventId, { stage = 'REGULAR', teams } = {}) {
      const series = this.listSeries(eventId, stage);
      const settings = this.getSettings(eventId);

      const equipos = new Map();
      const asegurar = (id, nombre) => {
        if (!equipos.has(id)) {
          equipos.set(id, {
            teamId: id, name: nombre ?? null,
            played: 0, wins: 0, losses: 0, roundsFor: 0, roundsAgainst: 0
          });
        }
        return equipos.get(id);
      };

      for (const equipo of teams || []) asegurar(equipo.id, equipo.name);
      for (const serie of series) { asegurar(serie.teamAId); asegurar(serie.teamBId); }

      // Enfrentamientos directos, para el desempate entre dos.
      const directos = new Map();
      const clave = (uno, otro) => `${uno}:${otro}`;

      for (const serie of series) {
        for (const juego of serie.games) {
          if (juego.status !== 'COMPLETED') continue;
          const a = asegurar(serie.teamAId);
          const b = asegurar(serie.teamBId);
          a.roundsFor += juego.teamARounds; a.roundsAgainst += juego.teamBRounds;
          b.roundsFor += juego.teamBRounds; b.roundsAgainst += juego.teamARounds;
        }
        if (serie.status !== 'COMPLETED' || !serie.winnerTeamId) continue;
        const ganador = asegurar(serie.winnerTeamId);
        const perdedor = asegurar(serie.winnerTeamId === serie.teamAId ? serie.teamBId : serie.teamAId);
        ganador.played += 1; ganador.wins += 1;
        perdedor.played += 1; perdedor.losses += 1;
        directos.set(clave(ganador.teamId, perdedor.teamId), 1);
        directos.set(clave(perdedor.teamId, ganador.teamId), -1);
      }

      const filas = [...equipos.values()].map((fila) => ({
        ...fila, roundDiff: fila.roundsFor - fila.roundsAgainst
      }));

      const porCriterio = (criterio, uno, otro, empatados) => {
        switch (criterio) {
          case 'wins': return otro.wins - uno.wins;
          case 'round_diff': return otro.roundDiff - uno.roundDiff;
          case 'rounds_for': return otro.roundsFor - uno.roundsFor;
          case 'head_to_head':
            // Sólo vale entre DOS. Con tres empatados, el «le gané a uno» no
            // ordena nada y aplicarlo daría un resultado arbitrario.
            if (empatados !== 2) return 0;
            return -(directos.get(clave(uno.teamId, otro.teamId)) ?? 0);
          default: return 0;
        }
      };

      // Cuántos comparten exactamente el mismo registro, para saber si el
      // enfrentamiento directo es aplicable.
      const huella = (fila) => `${fila.wins}|${fila.losses}`;
      const cuantosIgual = new Map();
      for (const fila of filas) cuantosIgual.set(huella(fila), (cuantosIgual.get(huella(fila)) ?? 0) + 1);

      // Devuelve 0 sólo cuando NINGÚN criterio configurado los separa: eso es un
      // empate que la organización tiene que resolver.
      const comparar = (uno, otro) => {
        const empatados = huella(uno) === huella(otro) ? cuantosIgual.get(huella(uno)) : 0;
        for (const criterio of settings.tiebreakers) {
          const resultado = porCriterio(criterio, uno, otro, empatados);
          if (resultado !== 0) return resultado;
        }
        return 0;
      };

      filas.sort((uno, otro) => comparar(uno, otro)
        // El orden final es alfabético para que la tabla no baile entre
        // recargas, pero eso NO es un desempate: se marca abajo.
        || String(uno.name ?? uno.teamId).localeCompare(String(otro.name ?? otro.teamId), 'es'));

      const jugadas = series.filter((s) => s.status === 'COMPLETED').length;
      const completa = series.length > 0 && jugadas === series.length;

      return {
        stage,
        settings,
        seriesTotal: series.length,
        seriesPlayed: jugadas,
        complete: completa,
        // Si ningún criterio configurado separa a dos vecinos en la tabla, el
        // orden que se ve es sólo el alfabético: lo decide la organización.
        // Nunca al azar, y nunca haciendo como si estuviera resuelto.
        tieRequiresAdmin: filas.some((fila, indice) =>
          indice > 0 && comparar(filas[indice - 1], fila) === 0),
        tieCode: filas.some((fila, indice) =>
          indice > 0 && comparar(filas[indice - 1], fila) === 0) ? 'TIE_REQUIRES_ADMIN' : null,
        standings: filas.map((fila, indice) => ({
          position: indice + 1,
          ...fila,
          qualified: completa ? indice < settings.qualifiers : null,
          tieRequiresAdmin: Boolean(
            (indice > 0 && comparar(filas[indice - 1], fila) === 0)
            || (indice < filas.length - 1 && comparar(fila, filas[indice + 1]) === 0))
        }))
      };
    },

    /** Lo que se puede enseñar a cualquiera. */
    publicCompetitionState(eventId, teams = []) {
      const nombre = new Map(teams.map((equipo) => [equipo.id, equipo.name]));
      const jornadas = this.matchdays(eventId).map((jornada) => ({
        matchday: jornada.matchday,
        bye: jornada.bye ? { teamId: jornada.bye, name: nombre.get(jornada.bye) ?? null } : null,
        series: jornada.series.map((serie) => ({
          id: serie.id,
          status: serie.status,
          bestOf: serie.bestOf,
          teamA: { teamId: serie.teamAId, name: nombre.get(serie.teamAId) ?? null },
          teamB: { teamId: serie.teamBId, name: nombre.get(serie.teamBId) ?? null },
          winnerTeamId: serie.winnerTeamId,
          games: serie.games.map((juego) => ({
            gameNumber: juego.gameNumber,
            mapKey: juego.mapKey,
            teamARounds: juego.teamARounds,
            teamBRounds: juego.teamBRounds,
            status: juego.status
          }))
        }))
      }));

      const tabla = this.standings(eventId, { teams });
      return {
        generated: jornadas.length > 0,
        matchdays: jornadas,
        standings: tabla.standings.map((fila) => ({ ...fila, name: nombre.get(fila.teamId) ?? fila.name })),
        seriesTotal: tabla.seriesTotal,
        seriesPlayed: tabla.seriesPlayed,
        complete: tabla.complete,
        tieRequiresAdmin: tabla.tieRequiresAdmin,
        qualifiers: tabla.settings.qualifiers,
        maps: this.listMaps(eventId)
      };
    }
  };

  return store;
}

module.exports = {
  migrateValorantCompetition,
  createValorantCompetitionStore,
  CompetitionError,
  RESULT_SOURCES,
  TIEBREAKERS,
  DEFAULT_MAP_POOL,
  SERIES_STATUSES,
  GAME_STATUSES
};
