'use strict';

const { roundRobinSchedule, scheduleSummary } = require('./services/round-robin');
const { validateValorantScore, DEFAULT_SCORE_POLICY } = require('./services/valorant-score');
const { officialValorantFormatForSlug, officialSizeForTeams } = require('./valorant-event-format');

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

/**
 * Las victorias mandan siempre y van primero: eso no es configurable. Poner la
 * diferencia de rondas por delante haría que un equipo con menos victorias
 * quedara por encima de otro con más, y eso ya no es una liga.
 *
 * Lo que la organización sí ordena es lo que viene DESPUÉS del empate a
 * victorias.
 */
const PRIMARY_TIEBREAKER = 'wins';
const SECONDARY_TIEBREAKERS = Object.freeze(['head_to_head', 'round_diff', 'team_stats', 'rounds_for']);

/**
 * ¿Hay una cadena de resoluciones que ponga a `arriba` por delante de `abajo`?
 *
 * Se sigue en cadena, no sólo la pareja directa: si A va por delante de B y B
 * por delante de C, entonces A va por delante de C aunque nadie lo dijera. Y
 * mirarlo así es lo que permite detectar un ciclo antes de crearlo.
 */
function caminoDeResolucion(arriba, abajo, resoluciones, vistos = new Set()) {
  if (vistos.has(arriba)) return false;
  vistos.add(arriba);
  return resoluciones.some((fila) => fila.higherTeamId === arriba
    && (fila.lowerTeamId === abajo
      || caminoDeResolucion(fila.lowerTeamId, abajo, resoluciones, new Set(vistos))));
}

/** -1, 1 o 0 según lo que haya decidido la organización. */
function compararPorResolucion(uno, otro, resoluciones) {
  if (caminoDeResolucion(uno.teamId, otro.teamId, resoluciones)) return -1;
  return caminoDeResolucion(otro.teamId, uno.teamId, resoluciones) ? 1 : 0;
}
const TIEBREAKERS = Object.freeze([PRIMARY_TIEBREAKER, ...SECONDARY_TIEBREAKERS]);

/** En esta fase clasifican cuatro. Con cuatro equipos, todos. */
const QUALIFIERS = 4;

/** Lo que hay que escribir para rehacer un calendario y perder los resultados. */
const REGENERATE_CONFIRMATION = 'REGENERATE';

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

    /*
      Ingesta de capturas. El lote es la unidad: varias imágenes del mismo
      partido se leen juntas y se confirman de una vez, porque una captura de
      Valorant y una de Tracker del mismo mapa se complementan.
    */
    CREATE TABLE IF NOT EXISTS valorant_capture_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      series_id INTEGER NOT NULL,
      game_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED','PROCESSING','REVIEW_REQUIRED','READY','CONFIRMED','REJECTED')),
      detected_source TEXT,
      detected_map TEXT,
      detected_team_a_rounds INTEGER,
      detected_team_b_rounds INTEGER,
      confidence REAL,
      parsed_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(series_id) REFERENCES valorant_series(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_batches_series ON valorant_capture_batches(series_id, game_number);

    CREATE TABLE IF NOT EXISTS valorant_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      original_filename TEXT,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      sha256 TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (source_kind IN ('VALORANT_POST_MATCH','VALORANT_SCOREBOARD','TRACKER_MATCH','UNKNOWN')),
      ocr_text TEXT,
      ocr_json TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(batch_id, sha256),
      FOREIGN KEY(batch_id) REFERENCES valorant_capture_batches(id) ON DELETE CASCADE
    );

    /*
      Estadísticas por jugador y partida. La columna stats_json guarda lo leído
      y todavía no tiene columna propia: no se pierde un dato sólo porque el
      esquema no lo previera.
    */
    CREATE TABLE IF NOT EXISTS valorant_player_game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      agent TEXT,
      acs INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      plus_minus INTEGER,
      adr INTEGER,
      hs_percent REAL,
      kast_percent REAL,
      first_kills INTEGER,
      first_deaths INTEGER,
      stats_json TEXT,
      source_capture_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(game_id, participant_id),
      FOREIGN KEY(game_id) REFERENCES valorant_games(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES event_participants(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(source_capture_id) REFERENCES valorant_captures(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stats_participant ON valorant_player_game_stats(participant_id);

    /*
      Cuando ningún criterio deportivo separa a dos equipos, lo resuelve la
      organización. Se guarda como una pareja ordenada —quién queda por
      delante de quién— y no como una posición fija: así una resolución sigue
      valiendo aunque después cambien los resultados de otros equipos.
    */
    CREATE TABLE IF NOT EXISTS valorant_tie_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'REGULAR',
      higher_team_id INTEGER NOT NULL,
      lower_team_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      resolved_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      CHECK (higher_team_id != lower_team_id),
      UNIQUE(event_id, stage, higher_team_id, lower_team_id),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(higher_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(lower_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tie_resolutions_event
      ON valorant_tie_resolutions(event_id, stage);

    CREATE TABLE IF NOT EXISTS valorant_settings (
      event_id INTEGER PRIMARY KEY,
      tiebreakers_json TEXT NOT NULL DEFAULT '["wins","head_to_head","round_diff","rounds_for"]',
      qualifiers INTEGER NOT NULL DEFAULT 4,
      map_pool_configured INTEGER NOT NULL DEFAULT 0 CHECK (map_pool_configured IN (0,1)),
      -- Vestigio: hubo un veto de mapas planeado que nunca llegó a existir.
      -- Los mapas los elige la organización. La columna se conserva porque
      -- quitarla obliga a rehacer la tabla, y nadie la lee.
      veto_rules_json TEXT NOT NULL DEFAULT '{"bo1":null,"bo3":null}',
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
  `);

  migrateLegacyValorantSchema(connection);
}

/**
 * Reconstruye las tablas legacy sin activar los ON DELETE CASCADE de sus hijos.
 *
 * SQLite no permite cambiar `foreign_keys` dentro de una transacción: sería un
 * no-op. Por eso se pausa antes de abrir la transacción, se valida el grafo aún
 * dentro de ella y se restaura siempre al terminar, también si algo falla.
 */
function migrateLegacyValorantSchema(connection) {
  if (connection.inTransaction) {
    throw new CompetitionError(
      'La migración Valorant necesita ejecutarse fuera de otra transacción.',
      'VALORANT_MIGRATION_TRANSACTION_ACTIVE', 500);
  }

  const foreignKeysEnabled = Boolean(connection.pragma('foreign_keys', { simple: true }));
  if (foreignKeysEnabled) connection.pragma('foreign_keys = OFF');

  try {
    connection.transaction(() => {
      migrateExtraStats(connection);
      migratePlayoffSeries(connection);
      migrateSkippedGames(connection);
  migrateAdvantageSeries(connection);

      // Cuántos mapas se juega la gran final. Se fija antes de empezar.
      const ajustes = connection.pragma('table_info(valorant_settings)').map((c) => c.name);
      if (!ajustes.includes('grand_final_best_of')) {
        connection.exec('ALTER TABLE valorant_settings ADD COLUMN grand_final_best_of INTEGER NOT NULL DEFAULT 3');
      }
      if (!ajustes.includes('map_pool_configured')) {
        connection.exec('ALTER TABLE valorant_settings ADD COLUMN map_pool_configured INTEGER NOT NULL DEFAULT 0 CHECK (map_pool_configured IN (0,1))');
      }
      if (!ajustes.includes('veto_rules_json')) {
        connection.exec(`ALTER TABLE valorant_settings ADD COLUMN veto_rules_json TEXT NOT NULL DEFAULT '{"bo1":null,"bo3":null}'`);
      }

      const violations = connection.pragma('foreign_key_check');
      if (violations.length > 0) {
        throw new CompetitionError(
          'La migración Valorant dejaría relaciones rotas.',
          'VALORANT_MIGRATION_FOREIGN_KEY_FAILED', 500);
      }
    })();
  } finally {
    if (foreignKeysEnabled) connection.pragma('foreign_keys = ON');
  }

  const violations = connection.pragma('foreign_key_check');
  if (violations.length > 0) {
    throw new CompetitionError(
      'La migración Valorant dejó relaciones rotas.',
      'VALORANT_MIGRATION_FOREIGN_KEY_FAILED', 500);
  }
}

/**
 * Columnas que salieron al leer capturas reales: Tracker enseña K/D, DDΔ y
 * multikills, y el cliente economía, spikes y desactivaciones.
 *
 * Se añaden con ALTER TABLE y no recreando la tabla: donde ya hay resultados
 * guardados, recrearla los borraría.
 */
/**
 * Prepara la tabla de series para las eliminatorias.
 *
 * Hacen falta dos cosas que la fase regular no necesitaba: que un partido pueda
 * existir SIN saber todavía quién lo juega —la final alta no tiene rivales
 * hasta que acaban las semis— y un identificador estable del hueco del cuadro.
 *
 * ⚠️ Como `team_a_id` nació NOT NULL, no basta con añadir columnas: hay que
 * rehacer la tabla. Se hace copiando lo que hubiera, que borrarla se llevaría
 * por delante los partidos ya jugados.
 */
function migratePlayoffSeries(connection) {
  const columnas = connection.pragma('table_info(valorant_series)').map((c) => c.name);
  if (columnas.includes('bracket_slot')) return;

  connection.exec(`
      CREATE TABLE valorant_series_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        stage TEXT NOT NULL DEFAULT 'REGULAR',
        matchday INTEGER NOT NULL,
        position INTEGER NOT NULL,
        bracket_slot TEXT,
        team_a_id INTEGER,
        team_b_id INTEGER,
        team_a_seed INTEGER,
        team_b_seed INTEGER,
        best_of INTEGER NOT NULL DEFAULT 1 CHECK (best_of IN (1,3,5)),
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','READY','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED')),
        winner_team_id INTEGER,
        scheduled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        updated_at TEXT NOT NULL DEFAULT (${NOW}),
        CHECK (team_a_id IS NULL OR team_b_id IS NULL OR team_a_id != team_b_id),
        UNIQUE(event_id, stage, matchday, position),
        UNIQUE(event_id, stage, bracket_slot),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY(team_a_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY(team_b_id) REFERENCES teams(id) ON DELETE CASCADE
      );

      INSERT INTO valorant_series_nueva
        (id, event_id, stage, matchday, position, team_a_id, team_b_id,
         best_of, status, winner_team_id, scheduled_at, created_at, updated_at)
      SELECT id, event_id, stage, matchday, position, team_a_id, team_b_id,
             best_of, status, winner_team_id, scheduled_at, created_at, updated_at
      FROM valorant_series;

      DROP TABLE valorant_series;
      ALTER TABLE valorant_series_nueva RENAME TO valorant_series;
      CREATE INDEX IF NOT EXISTS idx_series_event_stage ON valorant_series(event_id, stage, matchday);
    `);
}

/**
 * Una partida que ya no hace falta jugar.
 *
 * En un BO3 que acaba 2-0 el tercer mapa no se juega nunca. Dejarlo en
 * PENDING para siempre hace creer que falta algo; y no es lo mismo que
 * cancelarlo a mano, así que tiene su propio estado.
 */
/**
 * La columna que convierte una serie en «a dos de ventaja».
 *
 * `best_of` no sirve para esto: un BO3 tiene un final fijo —dos mapas— y aquí
 * el final depende de la distancia entre los dos. Cuando `win_by` está puesta,
 * manda ella y `best_of` deja de decidir nada.
 */
function migrateAdvantageSeries(connection) {
  const columnas = connection.pragma('table_info(valorant_series)').map((c) => c.name);
  if (!columnas.includes('win_by')) {
    connection.exec('ALTER TABLE valorant_series ADD COLUMN win_by INTEGER');
  }
}

function migrateSkippedGames(connection) {
  const definicion = connection.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='valorant_games'").get();
  if (!definicion || definicion.sql.includes('NOT_NEEDED')) return;

  connection.exec(definicion.sql
    .replace('CREATE TABLE valorant_games', 'CREATE TABLE valorant_games_nueva')
    .replace("'PENDING','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED'",
      "'PENDING','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED','NOT_NEEDED'"));
  connection.exec(`
      INSERT INTO valorant_games_nueva SELECT * FROM valorant_games;
      DROP TABLE valorant_games;
      ALTER TABLE valorant_games_nueva RENAME TO valorant_games;
      CREATE INDEX IF NOT EXISTS idx_stats_participant ON valorant_player_game_stats(participant_id);
    `);
}

function migrateExtraStats(connection) {
  const columnas = connection.pragma('table_info(valorant_player_game_stats)').map((c) => c.name);
  const nuevas = [
    ['kd_ratio', 'REAL'],
    ['dd_delta', 'INTEGER'],
    ['multi_kills', 'INTEGER'],
    ['economy_rating', 'INTEGER'],
    ['spikes_planted', 'INTEGER'],
    ['defuses', 'INTEGER'],
    // Lo que dijo cada fuente antes de conciliarlas: sin esto no se puede
    // averiguar después por qué un número no cuadraba.
    ['observations_json', 'TEXT']
  ];
  for (const [nombre, tipo] of nuevas) {
    if (!columnas.includes(nombre)) {
      connection.exec(`ALTER TABLE valorant_player_game_stats ADD COLUMN ${nombre} ${tipo}`);
    }
  }
}

function createValorantCompetitionStore(connection, { audit } = {}) {
  const registrar = audit || (() => {});
  // Las eliminatorias se enganchan después, al abrir la base: así hay UN solo
  // camino para aplicar un resultado, venga de una captura o de la mano.
  let playoffs = null;

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

  /** Ausente no es cero: lo que no se ve se guarda como NULL. */
  const entero = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.round(numero) : null;
  };

  /** Los decimales de verdad no se redondean: un ADR de 129.6 no es 130. */
  const decimal = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  };

  const porcentaje = (valor) => {
    const numero = entero(valor);
    if (numero === null) return null;
    if (numero < 0 || numero > 100) {
      throw new CompetitionError('Un porcentaje va de 0 a 100.', 'INVALID_PERCENT');
    }
    return numero;
  };

  const toStats = (row) => row && {
    gameId: row.game_id,
    kdRatio: row.kd_ratio,
    ddDelta: row.dd_delta,
    multiKills: row.multi_kills,
    economyRating: row.economy_rating,
    spikesPlanted: row.spikes_planted,
    defuses: row.defuses,
    observations: row.observations_json ? JSON.parse(row.observations_json) : null,
    participantId: row.participant_id,
    teamId: row.team_id,
    agent: row.agent,
    acs: row.acs,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    plusMinus: row.plus_minus,
    adr: row.adr,
    hsPercent: row.hs_percent,
    kastPercent: row.kast_percent,
    firstKills: row.first_kills,
    firstDeaths: row.first_deaths,
    extra: row.stats_json ? JSON.parse(row.stats_json) : null
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

    /** Las eliminatorias avisan de que existen; el resultado sigue entrando por aquí. */
    attachPlayoffs(store2) { playoffs = store2; },
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
        connection.prepare(`INSERT INTO valorant_settings (event_id,map_pool_configured)
          VALUES (?,1) ON CONFLICT(event_id) DO UPDATE SET
          map_pool_configured=1, updated_at=${NOW}`).run(eventId);
      });
      guardar();
      registrar(eventId, actor, 'MAP_POOL_UPDATED', null, null, { enabled: [...activos] });
      return this.listMaps(eventId);
    },

    enabledMapKeys(eventId) {
      return this.listMaps(eventId).filter((mapa) => mapa.enabled).map((mapa) => mapa.key);
    },

    /**
     * Qué se puede decir en público sobre los mapas.
     *
     * Los elige la organización y se anuncian antes de cada serie; no hay veto.
     * Mientras el pool no esté anunciado no se publica a medias: se dice que
     * está pendiente, que es la verdad.
     */
    getMapAnnouncement(eventId) {
      const row = connection.prepare(
        'SELECT map_pool_configured FROM valorant_settings WHERE event_id=?').get(eventId);
      const announced = Boolean(row?.map_pool_configured);
      return {
        status: announced ? 'MAP_POOL_ANNOUNCED' : 'MAP_POOL_NOT_ANNOUNCED',
        chosenBy: 'ORGANISATION',
        announcedBeforeSeries: true,
        pool: announced ? this.enabledMapKeys(eventId) : null
      };
    },

    // ---------------------------------------------------- fase regular

    getSettings(eventId) {
      const row = connection.prepare('SELECT * FROM valorant_settings WHERE event_id=?').get(eventId);
      const event = connection.prepare('SELECT slug FROM events WHERE id=?').get(eventId);
      const official = officialValorantFormatForSlug(event?.slug);
      const allowed = official
        ? official.tiebreakers.twoTeam
        : SECONDARY_TIEBREAKERS;
      const guardados = row ? JSON.parse(row.tiebreakers_json) : [...allowed];
      return {
        // Las victorias se reponen siempre las primeras aunque en la base haya
        // quedado otra cosa de una versión anterior.
        tiebreakers: [PRIMARY_TIEBREAKER, ...guardados.filter((c) =>
          c !== PRIMARY_TIEBREAKER && allowed.includes(c))],
        qualifiers: QUALIFIERS,
        scorePolicy: { ...DEFAULT_SCORE_POLICY }
      };
    },

    /**
     * La organización ordena los desempates que van DESPUÉS de las victorias.
     * Ni las victorias se pueden quitar ni el número de clasificados se toca:
     * son reglas de la fase, no preferencias.
     */
    setSettings(eventId, { tiebreakers, qualifiers, actor = 'admin' } = {}) {
      if (qualifiers !== undefined && Number(qualifiers) !== QUALIFIERS) {
        throw new CompetitionError(
          `En esta fase clasifican siempre ${QUALIFIERS}.`, 'QUALIFIERS_FIXED');
      }

      const event = connection.prepare('SELECT slug FROM events WHERE id=?').get(eventId);
      const official = officialValorantFormatForSlug(event?.slug);
      const permitted = official
        ? [PRIMARY_TIEBREAKER, ...official.tiebreakers.twoTeam]
        : TIEBREAKERS;
      const pedidos = (tiebreakers ?? permitted).map(String);
      // Comprobar antes la regla estructural de victorias para conservar un
      // error preciso aunque la lista incluya además un criterio pendiente.
      const posicion = pedidos.indexOf(PRIMARY_TIEBREAKER);
      if (posicion > 0) {
        throw new CompetitionError(
          'Las victorias mandan siempre y van las primeras.', 'WINS_MUST_BE_FIRST');
      }
      for (const criterio of pedidos) {
        if (!permitted.includes(criterio)) {
          if (official && TIEBREAKERS.includes(criterio)) {
            throw new CompetitionError(
              'Ese desempate sigue pendiente de decisión oficial.',
              'OFFICIAL_TIEBREAKER_NOT_CONFIGURED');
          }
          throw new CompetitionError(`Criterio de desempate desconocido: ${criterio}.`, 'UNKNOWN_TIEBREAKER');
        }
      }
      // Aceptar la lista con 'wins' delante o sin ella, pero nunca con 'wins'
      // en otro sitio: eso sería pedir que la diferencia de rondas mande.
      const secundarios = pedidos.filter((c) => c !== PRIMARY_TIEBREAKER);
      if (new Set(secundarios).size !== secundarios.length) {
        throw new CompetitionError('Hay un criterio de desempate repetido.', 'DUPLICATE_TIEBREAKER');
      }

      connection.prepare(`
        INSERT INTO valorant_settings (event_id,tiebreakers_json,qualifiers) VALUES (?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET
          tiebreakers_json=excluded.tiebreakers_json, qualifiers=excluded.qualifiers, updated_at=${NOW}
      `).run(eventId, JSON.stringify(secundarios), QUALIFIERS);
      registrar(eventId, actor, 'COMPETITION_SETTINGS_UPDATED', null, null,
        { tiebreakers: [PRIMARY_TIEBREAKER, ...secundarios] });
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

    /** Cuántos partidos ya tienen resultado: lo que se perdería al rehacer. */
    completedCount(eventId, stage = 'REGULAR') {
      return connection.prepare(`
        SELECT COUNT(*) total FROM valorant_games g
        JOIN valorant_series s ON s.id = g.series_id
        WHERE s.event_id=? AND s.stage=? AND g.status='COMPLETED'`).get(eventId, stage).total;
    },

    /**
     * Crea el calendario. Nunca borra nada: si ya existe, se niega. Rehacerlo
     * es otra operación, `regenerateRegularSeason`, precisamente para que un
     * booleano suelto en un cuerpo JSON no pueda tirar la fase regular entera.
     */
    generateRegularSeason(eventId, teamIds, { bestOf = 1, actor = 'admin' } = {}) {
      if (this.hasRegularSeason(eventId)) {
        throw new CompetitionError(
          'La fase regular ya está generada. Rehacerla es otra operación.',
          'REGULAR_SEASON_EXISTS', 409);
      }
      return this.buildRegularSeason(eventId, teamIds, { bestOf, actor });
    },

    /**
     * Rehace el calendario BORRANDO los partidos y sus resultados.
     *
     * Pide un texto exacto además del motivo: un `force: true` es demasiado
     * fácil de mandar por error desde un cliente, y esto no se puede deshacer.
     */
    regenerateRegularSeason(eventId, teamIds, { bestOf = 1, actor = 'admin', reason = null, confirmation = null } = {}) {
      if (!this.hasRegularSeason(eventId)) {
        throw new CompetitionError(
          'No hay ninguna fase regular que rehacer.', 'REGULAR_SEASON_MISSING', 409);
      }
      if (!reason || !String(reason).trim()) {
        throw new CompetitionError('Hace falta un motivo.', 'REASON_REQUIRED');
      }
      if (String(confirmation) !== REGENERATE_CONFIRMATION) {
        throw new CompetitionError(
          `Rehacer el calendario borra los partidos y sus resultados. Para confirmarlo hay que escribir ${REGENERATE_CONFIRMATION}.`,
          'CONFIRMATION_REQUIRED');
      }

      const perdidos = this.completedCount(eventId);
      const hecho = this.buildRegularSeason(eventId, teamIds, {
        bestOf, actor, reason, replace: true, discardedResults: perdidos
      });
      return { series: hecho, discardedResults: perdidos };
    },

    /** El trabajo común de generar y rehacer. No comprueba permisos: ya lo hicieron. */
    buildRegularSeason(eventId, teamIds, { bestOf = 1, actor = 'admin', reason = null, replace = false, discardedResults = 0 } = {}) {
      if (!Array.isArray(teamIds) || teamIds.length < 2) {
        throw new CompetitionError('Hacen falta al menos dos equipos.', 'NOT_ENOUGH_TEAMS');
      }
      const event = connection.prepare('SELECT slug FROM events WHERE id=?').get(eventId);
      const official = officialValorantFormatForSlug(event?.slug);
      if (official && (!officialSizeForTeams(teamIds.length) || Number(bestOf) !== official.regularSeason.bestOf)) {
        throw new CompetitionError(
          `El torneo oficial se juega con ${official.allowedTeamCounts.join(', ')} equipos y fase regular BO${official.regularSeason.bestOf}.`,
          'OFFICIAL_REGULAR_FORMAT_MISMATCH');
      }

      const calendario = roundRobinSchedule(teamIds);

      const generar = connection.transaction(() => {
        if (replace) {
          // ON DELETE CASCADE se lleva partidas, y con ellas las estadísticas.
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

      registrar(eventId, actor, replace ? 'REGULAR_SEASON_REGENERATED' : 'REGULAR_SEASON_GENERATED',
        null, reason, {
          teams: teamIds.length,
          ...scheduleSummary(teamIds.length),
          ...(replace ? { discardedResults } : {})
        });
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

    assignMap(eventId, { seriesId, gameNumber = 1, mapKey, actor = 'admin', allowRepeat = false }) {
      const serie = connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
        .get(seriesId, eventId);
      if (!serie) throw new CompetitionError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

      const clave = String(mapKey || '').trim().toLowerCase();
      if (!this.enabledMapKeys(eventId).includes(clave)) {
        throw new CompetitionError(
          'Ese mapa no está habilitado para este torneo.', 'MAP_NOT_ENABLED');
      }

      /*
        Dentro de una misma serie no se repite mapa: jugar dos veces el mismo
        en un BO3 no es un formato, es un despiste. No hay vetos ni sorteo; lo
        elige la organización, sólo que sin repetir.
      */
      if (!allowRepeat) {
        const repetido = connection.prepare(
          'SELECT game_number FROM valorant_games WHERE series_id=? AND map_key=? AND game_number!=?'
        ).get(seriesId, clave, gameNumber);
        if (repetido) {
          throw new CompetitionError(
            `Ese mapa ya está asignado al mapa ${repetido.game_number} de esta serie.`,
            'MAP_ALREADY_IN_SERIES');
        }
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

    // ---------------------------------------------------- estadísticas

    /**
     * Reemplaza las estadísticas de una partida. Va dentro de la transacción de
     * quien la llama: si el resultado no entra, las estadísticas tampoco.
     */
    _replaceGameStats(gameId, serie, jugadores, captureBatchId = null) {
      connection.prepare('DELETE FROM valorant_player_game_stats WHERE game_id=?').run(gameId);
      const insertar = connection.prepare(`
        INSERT INTO valorant_player_game_stats
          (game_id, participant_id, team_id, agent, acs, kills, deaths, assists, plus_minus,
           adr, hs_percent, kast_percent, first_kills, first_deaths, stats_json, source_capture_id,
           kd_ratio, dd_delta, multi_kills, economy_rating, spikes_planted, defuses, observations_json)
        VALUES (@gameId, @participantId, @teamId, @agent, @acs, @kills, @deaths, @assists, @plusMinus,
                @adr, @hsPercent, @kastPercent, @firstKills, @firstDeaths, @statsJson, @sourceCaptureId,
                @kdRatio, @ddDelta, @multiKills, @economyRating, @spikesPlanted, @defuses, @observationsJson)`);

      const equipos = new Set([serie.team_a_id, serie.team_b_id]);
      const vistos = new Set();

      for (const jugador of jugadores) {
        const participantId = Number(jugador.participantId);
        const teamId = Number(jugador.teamId);
        if (!equipos.has(teamId)) {
          throw new CompetitionError(
            'Ese equipo no juega este partido.', 'TEAM_NOT_IN_SERIES');
        }
        if (vistos.has(participantId)) {
          throw new CompetitionError(
            'Un jugador no puede aparecer dos veces en la misma partida.', 'DUPLICATE_PLAYER');
        }
        vistos.add(participantId);

        insertar.run({
          gameId,
          participantId,
          teamId,
          agent: jugador.agent ?? null,
          // Ausente y cero son cosas distintas: un dato que no se ve queda NULL.
          acs: entero(jugador.acs),
          kills: entero(jugador.kills),
          deaths: entero(jugador.deaths),
          assists: entero(jugador.assists),
          plusMinus: entero(jugador.plusMinus),
          adr: decimal(jugador.adr),
          hsPercent: porcentaje(jugador.hsPercent),
          kastPercent: porcentaje(jugador.kastPercent),
          firstKills: entero(jugador.firstKills),
          firstDeaths: entero(jugador.firstDeaths),
          kdRatio: decimal(jugador.kdRatio),
          ddDelta: entero(jugador.ddDelta),
          multiKills: entero(jugador.multiKills),
          economyRating: entero(jugador.economyRating),
          spikesPlanted: entero(jugador.spikesPlanted),
          defuses: entero(jugador.defuses),
          statsJson: jugador.extra && Object.keys(jugador.extra).length
            ? JSON.stringify(jugador.extra) : null,
          // Lo que decía cada fuente, incluida la que no manda.
          observationsJson: jugador.observations && Object.keys(jugador.observations).length
            ? JSON.stringify(jugador.observations) : null,
          sourceCaptureId: jugador.sourceCaptureId ?? null
        });
      }

      if (captureBatchId) {
        connection.prepare(
          `UPDATE valorant_capture_batches SET status='CONFIRMED', confirmed_at=${NOW} WHERE id=?`
        ).run(captureBatchId);
      }
    },

    /**
     * Estadísticas de todo el torneo, por jugador.
     *
     * ⚠️ Los promedios se calculan SÓLO entre las partidas donde el dato está.
     * Si una captura no traía ADR, esa partida no cuenta para la media de ADR;
     * meterla como 0 hundiría el promedio de alguien por un fallo de lectura.
     */
    tournamentPlayerStats(eventId, { stage = 'REGULAR' } = {}) {
      const stageFilter = stage ? ' AND s.stage=?' : '';
      const filas = connection.prepare(`
        SELECT st.*, g.series_id
        FROM valorant_player_game_stats st
        JOIN valorant_games g ON g.id = st.game_id
        JOIN valorant_series s ON s.id = g.series_id
        WHERE s.event_id=?${stageFilter} AND g.status='COMPLETED'`).all(...(stage ? [eventId, stage] : [eventId]));

      const porJugador = new Map();
      for (const fila of filas) {
        if (!porJugador.has(fila.participant_id)) {
          porJugador.set(fila.participant_id, {
            participantId: fila.participant_id,
            teamId: fila.team_id,
            games: 0,
            kills: 0, deaths: 0, assists: 0,
            firstKills: 0, firstDeaths: 0,
            kdKills: 0, kdDeaths: 0, kdSamples: 0,
            agents: new Map(),
            // Cada promedio lleva su propio contador: no todas las partidas
            // aportan todos los datos.
            promedios: { acs: [], adr: [], hsPercent: [], kastPercent: [] },
            counted: { kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0 }
          });
        }
        const acumulado = porJugador.get(fila.participant_id);
        acumulado.games += 1;

        for (const campo of ['kills', 'deaths', 'assists']) {
          const valor = fila[campo];
          if (valor !== null) { acumulado[campo] += valor; acumulado.counted[campo] += 1; }
        }
        if (fila.kills !== null && fila.deaths !== null) {
          acumulado.kdKills += fila.kills;
          acumulado.kdDeaths += fila.deaths;
          acumulado.kdSamples += 1;
        }
        if (fila.first_kills !== null) { acumulado.firstKills += fila.first_kills; acumulado.counted.firstKills += 1; }
        if (fila.first_deaths !== null) { acumulado.firstDeaths += fila.first_deaths; acumulado.counted.firstDeaths += 1; }

        for (const [campo, columna] of [['acs', 'acs'], ['adr', 'adr'],
          ['hsPercent', 'hs_percent'], ['kastPercent', 'kast_percent']]) {
          if (fila[columna] !== null) acumulado.promedios[campo].push(fila[columna]);
        }
        if (fila.agent) {
          acumulado.agents.set(fila.agent, (acumulado.agents.get(fila.agent) ?? 0) + 1);
        }
      }

      const media = (valores) => valores.length
        ? Math.round((valores.reduce((total, v) => total + v, 0) / valores.length) * 10) / 10
        : null;

      return [...porJugador.values()].map((acumulado) => {
        const agentes = [...acumulado.agents.entries()].sort((uno, otro) => otro[1] - uno[1]);
        return {
          participantId: acumulado.participantId,
          teamId: acumulado.teamId,
          games: acumulado.games,
          kills: acumulado.counted.kills ? acumulado.kills : null,
          deaths: acumulado.counted.deaths ? acumulado.deaths : null,
          assists: acumulado.counted.assists ? acumulado.assists : null,
          firstKills: acumulado.counted.firstKills ? acumulado.firstKills : null,
          firstDeaths: acumulado.counted.firstDeaths ? acumulado.firstDeaths : null,
          // Sin muertes registradas no hay K/D que calcular; y con cero muertes
          // se enseña el número de kills, no una división por cero.
          kd: acumulado.kdSamples
            ? Math.round((acumulado.kdKills / Math.max(1, acumulado.kdDeaths)) * 100) / 100
            : null,
          acs: media(acumulado.promedios.acs),
          adr: media(acumulado.promedios.adr),
          hsPercent: media(acumulado.promedios.hsPercent),
          kastPercent: media(acumulado.promedios.kastPercent),
          // Cuántas partidas respaldan cada promedio, para no comparar peras
          // con manzanas cuando unas capturas traían la columna y otras no.
          sampleSizes: {
            acs: acumulado.promedios.acs.length,
            adr: acumulado.promedios.adr.length,
            hsPercent: acumulado.promedios.hsPercent.length,
            kastPercent: acumulado.promedios.kastPercent.length,
            kills: acumulado.counted.kills,
            deaths: acumulado.counted.deaths,
            assists: acumulado.counted.assists,
            firstKills: acumulado.counted.firstKills,
            firstDeaths: acumulado.counted.firstDeaths,
            kd: acumulado.kdSamples
          },
          topAgent: agentes.length ? agentes[0][0] : null
        };
      }).sort((uno, otro) => (otro.kills ?? -1) - (uno.kills ?? -1));
    },

    listGameStats(gameId) {
      return connection.prepare(
        'SELECT * FROM valorant_player_game_stats WHERE game_id=? ORDER BY team_id, acs DESC, kills DESC'
      ).all(gameId).map(toStats);
    },

    /**
     * Escribe a mano las estadísticas de una partida ya jugada.
     *
     * Camino aparte del resultado: aquí NO se toca el marcador. Sirve para
     * cuando la captura no vale, no existe, o simplemente se prefiere teclear
     * mirando la pantalla del juego. Quien organiza ve la tabla con sus ojos y
     * tiene que poder corregir cualquier celda.
     *
     * Pide motivo, como toda escritura a mano, y queda en la auditoría.
     */
    setGameStats(eventId, { seriesId, gameNumber = 1, stats, reason, actor = 'admin' }) {
      if (!reason || !String(reason).trim()) {
        throw new CompetitionError('Hace falta un motivo.', 'REASON_REQUIRED');
      }
      if (!Array.isArray(stats)) {
        throw new CompetitionError('Las estadísticas son una lista de jugadores.', 'STATS_REQUIRED');
      }

      const serie = connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
        .get(seriesId, eventId);
      if (!serie) throw new CompetitionError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

      const juego = connection.prepare(
        'SELECT * FROM valorant_games WHERE series_id=? AND game_number=?').get(seriesId, gameNumber);
      if (!juego) throw new CompetitionError('Esa partida no existe.', 'GAME_NOT_FOUND', 404);
      if (juego.status !== 'COMPLETED') {
        throw new CompetitionError(
          'La partida todavía no tiene resultado: primero el marcador.', 'RESULT_NOT_RECORDED', 409);
      }

      const antes = this.listGameStats(juego.id);
      connection.transaction(() => {
        this._replaceGameStats(juego.id, serie, stats, null);
      })();

      registrar(eventId, actor, 'GAME_STATS_EDITED', `series:${seriesId}`, reason, {
        gameNumber, players: stats.length, previousPlayers: antes.length
      });
      return this.listGameStats(juego.id);
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
    /**
     * Guarda el resultado de una partida.
     *
     * Nunca sobrescribe: corregir un resultado ya cerrado es `correctGameResult`,
     * una acción distinta. Que el mismo endpoint sirviera para las dos cosas
     * dependiendo de un campo del cuerpo convertía un error de tecleo en un
     * borrado silencioso.
     */
    recordGameResult(eventId, { seriesId, gameNumber = 1, teamARounds, teamBRounds, source = 'MANUAL', reason = null, actor = 'admin', stats = null, captureBatchId = null }) {
      return this._writeResult(eventId, {
        seriesId, gameNumber, teamARounds, teamBRounds, source, reason, actor, stats, captureBatchId,
        overwrite: false
      });
    },

    /**
     * Corrige un resultado ya cerrado. Guarda en la auditoría qué había antes y
     * qué queda: sin eso, tres días después nadie sabe explicar el cambio.
     */
    correctGameResult(eventId, { seriesId, gameNumber = 1, teamARounds, teamBRounds, source = 'MANUAL', reason = null, actor = 'admin', stats = null, captureBatchId = null }) {
      return this._writeResult(eventId, {
        seriesId, gameNumber, teamARounds, teamBRounds, source, reason, actor, stats, captureBatchId,
        overwrite: true
      });
    },

    _writeResult(eventId, { seriesId, gameNumber, teamARounds, teamBRounds, source, reason, actor, overwrite, stats, captureBatchId }) {
      if (!RESULT_SOURCES.includes(source)) {
        throw new CompetitionError('Origen de resultado desconocido.', 'UNKNOWN_RESULT_SOURCE');
      }
      // Una captura confirmada es su propia justificación: lleva las imágenes
      // detrás. Lo que se teclea a mano, no.
      const motivoObligatorio = overwrite || source !== 'SCREENSHOT';
      if (motivoObligatorio && (!reason || !String(reason).trim())) {
        throw new CompetitionError('Hace falta un motivo.', 'REASON_REQUIRED');
      }

      const marcador = validateValorantScore(teamARounds, teamBRounds, this.getSettings(eventId).scorePolicy);
      if (!marcador.ok) throw new CompetitionError(marcador.message, marcador.code);
      const a = Number(teamARounds);
      const b = Number(teamBRounds);

      const guardar = connection.transaction(() => {
        const serie = connection.prepare('SELECT * FROM valorant_series WHERE id=? AND event_id=?')
          .get(seriesId, eventId);
        if (!serie) throw new CompetitionError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

        const juego = connection.prepare('SELECT * FROM valorant_games WHERE series_id=? AND game_number=?')
          .get(seriesId, gameNumber);
        if (!juego) throw new CompetitionError('Esa partida no existe.', 'GAME_NOT_FOUND', 404);

        // El resultado pertenece a serie + partida + MAPA. Sin mapa asignado no
        // se sabe de qué partida es, y con capturas eso importa todavía más.
        if (!juego.map_key) {
          throw new CompetitionError(
            'Asigna el mapa antes de registrar el resultado.', 'MAP_REQUIRED', 409);
        }

        if (juego.status === 'COMPLETED' && !overwrite) {
          throw new CompetitionError(
            'Esa partida ya tiene resultado. Corregirlo es otra acción.',
            'RESULT_ALREADY_RECORDED', 409);
        }
        if (juego.status !== 'COMPLETED' && overwrite) {
          throw new CompetitionError(
            'Esa partida todavía no tiene resultado que corregir.', 'RESULT_NOT_RECORDED', 409);
        }

        // El ganador sale del marcador. Aceptarlo de fuera permitiría registrar
        // un 13-8 perdido.
        const oldGameWinner = juego.winner_team_id ?? null;
        const newGameWinner = marcador.winner === 'a' ? serie.team_a_id : serie.team_b_id;
        const prospectiveWins = new Map();
        const games = connection.prepare(
          'SELECT id,status,winner_team_id FROM valorant_games WHERE series_id=? ORDER BY game_number'
        ).all(seriesId);
        for (const row of games) {
          const winner = row.id === juego.id
            ? newGameWinner
            : (row.status === 'COMPLETED' ? row.winner_team_id : null);
          if (winner) prospectiveWins.set(winner, (prospectiveWins.get(winner) ?? 0) + 1);
        }

        /*
          Dos formas de cerrar una serie, y sólo una se aplica a cada una.

          Al mejor de N gana quien llega a la mitad más uno. Por ventaja gana
          quien saca `win_by` mapas al otro: 2-0, 3-1, 4-2… Un 2-1 no cierra
          nada, y por eso estas series no tienen sus partidas creadas de
          antemano: no se sabe cuántas van a hacer falta.
        */
        const ganadasA = prospectiveWins.get(serie.team_a_id) ?? 0;
        const ganadasB = prospectiveWins.get(serie.team_b_id) ?? 0;
        const newSeriesWinner = serie.win_by
          ? (Math.abs(ganadasA - ganadasB) >= serie.win_by
            ? (ganadasA > ganadasB ? serie.team_a_id : serie.team_b_id)
            : null)
          : ([...prospectiveWins.entries()]
            .find(([, wins]) => wins >= Math.floor(serie.best_of / 2) + 1)?.[0] ?? null);
        const oldSeriesWinner = serie.winner_team_id ?? null;
        const seriesWinnerChanges = oldSeriesWinner !== newSeriesWinner;

        /*
          ⚠️ Sólo un cambio prospectivo del ganador de la SERIE puede alterar el
          cuadro. Corregir rondas, o incluso un mapa manteniendo el mismo ganador
          final, no toca participantes downstream y no debe quedar bloqueado.
        */
        if (overwrite && seriesWinnerChanges && serie.stage === 'PLAYOFFS' && playoffs) {
          const iniciadas = playoffs.startedDependents(eventId, serie.bracket_slot);
          if (iniciadas.length > 0) {
            throw new CompetitionError(
              'No se puede corregir: el cuadro ya ha avanzado sobre este resultado '
              + `(${iniciadas.map((s) => s.slot).join(', ')}).`,
              'BRACKET_DEPENDENCY_LOCKED', 409);
          }
        }

        connection.prepare(`
          UPDATE valorant_games
          SET team_a_rounds=?, team_b_rounds=?, winner_team_id=?, result_source=?,
              status='COMPLETED', updated_at=${NOW}
          WHERE id=?`).run(a, b, newGameWinner, source, juego.id);

        if (stats) this._replaceGameStats(juego.id, serie, stats, captureBatchId);

        // La serie se cierra cuando alguien llega a los mapas necesarios.
        if (newSeriesWinner) {
          connection.prepare(
            `UPDATE valorant_series SET status='COMPLETED', winner_team_id=?, updated_at=${NOW} WHERE id=?`
          ).run(newSeriesWinner, seriesId);
        } else {
          connection.prepare(
            `UPDATE valorant_series SET status='WAITING_RESULT', winner_team_id=NULL, updated_at=${NOW} WHERE id=?`
          ).run(seriesId);
        }

        // El cuadro se mueve DENTRO de la transacción: si el resultado no
        // entra, tampoco avanza nadie de ronda.
        if (serie.stage === 'PLAYOFFS' && playoffs) {
          if (overwrite && seriesWinnerChanges) playoffs.clearDownstream(eventId, serie.bracket_slot);
          playoffs.propagate(eventId, { actor });
          playoffs.ensureNextFinalGame(eventId, seriesId);
          playoffs.markUnneededGames(eventId);
        }

        return {
          ganador: newGameWinner,
          oldGameWinner,
          antes: juego.status === 'COMPLETED'
            ? { teamARounds: juego.team_a_rounds, teamBRounds: juego.team_b_rounds, source: juego.result_source }
            : null
        };
      });

      const { ganador, antes } = guardar();
      registrar(eventId, actor, overwrite ? 'RESULT_CORRECTED' : 'RESULT_RECORDED',
        `series:${seriesId}`, reason, {
          gameNumber, teamARounds: a, teamBRounds: b, source, winnerTeamId: ganador,
          overtime: marcador.overtime,
          ...(captureBatchId ? { captureBatchId } : {}),
          ...(antes ? { previous: antes } : {})
        });
      return this.getSeries(eventId, seriesId);
    },

    // -------------------------------------------------------- clasificación

    /**
     * Se calcula de los resultados, no se guarda. Una tabla derivable que además
     * se almacena acaba discrepando de sus propios datos.
     */
    /**
     * Lo que un jugador quiere saber de su equipo sin recorrer tres páginas:
     * cómo va y contra quién juega la próxima vez.
     *
     * Devuelve null en lo que todavía no exista —una liga sin generar no tiene
     * clasificación, y un equipo que ya jugó todo no tiene próximo partido—
     * en vez de inventar ceros que parecerían datos.
     */
    teamSnapshot(eventId, teamId, { teams } = {}) {
      const equipo = Number(teamId);
      const SIN_LIGA = { standing: null, seriesPlayed: null, seriesTotal: null, nextMatch: null };
      if (!Number.isInteger(equipo)) return SIN_LIGA;

      const series = this.listSeries(eventId);
      if (series.length === 0) return SIN_LIGA;

      const tabla = this.standings(eventId, { teams });
      const fila = tabla.standings.find((row) => row.teamId === equipo) ?? null;

      const nombre = new Map((teams || []).map((e) => [e.id, e.name]));
      const suyas = series.filter(
        (serie) => serie.teamAId === equipo || serie.teamBId === equipo);

      // El próximo es el primero sin terminar; las series van ordenadas por
      // jornada, así que basta con el primero que aparezca.
      const siguiente = suyas.find((serie) => serie.status !== 'COMPLETED') ?? null;
      const jugadas = suyas.filter((serie) => serie.status === 'COMPLETED').length;

      return {
        standing: fila ? {
          position: fila.position,
          played: fila.played,
          wins: fila.wins,
          losses: fila.losses,
          roundDiff: fila.roundDiff,
          qualified: fila.qualified,
          tieRequiresAdmin: fila.tieRequiresAdmin
        } : null,
        seriesPlayed: jugadas,
        seriesTotal: suyas.length,
        nextMatch: siguiente ? {
          matchday: siguiente.matchday,
          opponentTeamId: siguiente.teamAId === equipo ? siguiente.teamBId : siguiente.teamAId,
          opponentName: nombre.get(
            siguiente.teamAId === equipo ? siguiente.teamBId : siguiente.teamAId) ?? null,
          maps: siguiente.games.map((juego) => juego.mapKey).filter(Boolean),
          bestOf: siguiente.bestOf,
          scheduledAt: siguiente.scheduledAt ?? null
        } : null
      };
    },

    listTieResolutions(eventId, stage = 'REGULAR') {
      return connection.prepare(`SELECT id, event_id eventId, stage,
        higher_team_id higherTeamId, lower_team_id lowerTeamId,
        reason, resolved_by resolvedBy, created_at createdAt
        FROM valorant_tie_resolutions WHERE event_id=? AND stage=? ORDER BY id`).all(eventId, stage);
    },

    /**
     * La organización decide quién queda por delante cuando el deporte no lo
     * decide. No es un criterio más: es reconocer que no hay criterio.
     *
     * Sólo se admite entre equipos que estén empatados de verdad —si algún
     * criterio ya los separa, resolverlos a mano sería reescribir el
     * resultado— y siempre con un motivo que quede registrado.
     */
    resolveTie(eventId, { higherTeamId, lowerTeamId, reason, stage = 'REGULAR', actor = 'admin' } = {}) {
      const arriba = Number(higherTeamId);
      const abajo = Number(lowerTeamId);
      if (!Number.isInteger(arriba) || !Number.isInteger(abajo) || arriba === abajo) {
        throw new CompetitionError(
          'El desempate necesita dos equipos distintos.', 'TIE_TEAMS_REQUIRED');
      }
      const motivo = String(reason || '').trim();
      if (!motivo) {
        throw new CompetitionError(
          'El desempate necesita un motivo auditable.', 'TIE_REASON_REQUIRED');
      }

      const tabla = this.standings(eventId, { stage, applyResolutions: false });
      const filaArriba = tabla.standings.find((fila) => fila.teamId === arriba);
      const filaAbajo = tabla.standings.find((fila) => fila.teamId === abajo);
      if (!filaArriba || !filaAbajo) {
        throw new CompetitionError(
          'Alguno de los equipos no juega esta fase.', 'TIE_TEAM_SCOPE', 409);
      }

      /*
        Empatados de verdad significa: contiguos en la tabla y sin que ningún
        criterio los separe. Si están lejos, lo que hay que mirar es el
        resultado, no el desempate.
      */
      const distancia = Math.abs(filaArriba.position - filaAbajo.position);
      if (distancia !== 1 || !(filaArriba.tieRequiresAdmin && filaAbajo.tieRequiresAdmin)) {
        throw new CompetitionError(
          'Sólo se pueden ordenar a mano equipos que ningún criterio separa.',
          'TEAMS_NOT_TIED', 409);
      }

      const resoluciones = this.listTieResolutions(eventId, stage);
      const existente = resoluciones.find(
        (fila) => fila.higherTeamId === arriba && fila.lowerTeamId === abajo);
      // Decir «A por delante de B» cuando ya consta «B por delante de A»
      // dejaría un orden imposible: se rechaza en vez de dejar la última.
      if (!existente && caminoDeResolucion(abajo, arriba, resoluciones)) {
        throw new CompetitionError(
          'Esa decisión contradice otra ya tomada.', 'TIE_RESOLUTION_CYCLE', 409);
      }

      connection.prepare(`INSERT INTO valorant_tie_resolutions
        (event_id, stage, higher_team_id, lower_team_id, reason, resolved_by)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(event_id, stage, higher_team_id, lower_team_id) DO UPDATE SET
          reason=excluded.reason, resolved_by=excluded.resolved_by, created_at=${NOW}`)
        .run(eventId, stage, arriba, abajo, motivo, actor);

      registrar(eventId, actor, 'TIE_RESOLVED', null, null,
        { stage, higherTeamId: arriba, lowerTeamId: abajo, reason: motivo });
      return this.listTieResolutions(eventId, stage);
    },

    /** Deshacer una decisión: la tabla vuelve a marcar el empate. */
    clearTieResolution(eventId, { higherTeamId, lowerTeamId, stage = 'REGULAR', actor = 'admin' } = {}) {
      const info = connection.prepare(`DELETE FROM valorant_tie_resolutions
        WHERE event_id=? AND stage=? AND higher_team_id=? AND lower_team_id=?`)
        .run(eventId, stage, Number(higherTeamId), Number(lowerTeamId));
      if (info.changes === 0) {
        throw new CompetitionError('Esa decisión no existe.', 'TIE_RESOLUTION_NOT_FOUND', 404);
      }
      registrar(eventId, actor, 'TIE_RESOLUTION_CLEARED', null, null,
        { stage, higherTeamId: Number(higherTeamId), lowerTeamId: Number(lowerTeamId) });
      return this.listTieResolutions(eventId, stage);
    },

    /**
     * `applyResolutions: false` da la tabla tal y como la deja el deporte, sin
     * las decisiones de la organización. Hace falta para poder preguntar si dos
     * equipos siguen empatados DESPUÉS de haberlos ordenado a mano.
     */
    standings(eventId, { stage = 'REGULAR', teams, applyResolutions = true } = {}) {
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

      /*
        Rendimiento del equipo, para cuando el marcador no separa.

        Se usa el **ACS medio por jugador y partida**, que es la medida
        estándar de quién jugó mejor en VALORANT. Los totales premiarían a
        quien más partidas jugó, y aquí todos juegan las mismas.

        ⚠️ Sólo existe si los resultados entraron por captura: un marcador
        tecleado a mano no trae estadísticas. Sin datos de alguno de los dos,
        el criterio no separa y se pasa al siguiente.
      */
      const rendimiento = new Map();
      for (const fila of connection.prepare(`
        SELECT st.team_id, AVG(st.acs) media, COUNT(st.acs) muestras
        FROM valorant_player_game_stats st
        JOIN valorant_games g ON g.id = st.game_id
        JOIN valorant_series s ON s.id = g.series_id
        WHERE s.event_id=? AND s.stage=? AND g.status='COMPLETED' AND st.acs IS NOT NULL
        GROUP BY st.team_id`).all(eventId, stage)) {
        if (fila.muestras > 0) rendimiento.set(fila.team_id, fila.media);
      }

      const porCriterio = (criterio, uno, otro, empatados) => {
        switch (criterio) {
          case 'wins': return otro.wins - uno.wins;
          case 'round_diff': return otro.roundDiff - uno.roundDiff;
          case 'rounds_for': return otro.roundsFor - uno.roundsFor;
          case 'team_stats': {
            const mio = rendimiento.get(uno.teamId);
            const suyo = rendimiento.get(otro.teamId);
            // Sin estadísticas de alguno no se compara: mejor pasar al
            // siguiente criterio que ordenar contra la nada.
            if (mio === undefined || suyo === undefined || mio === suyo) return 0;
            return suyo - mio;
          }
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
      const resoluciones = applyResolutions ? this.listTieResolutions(eventId, stage) : [];
      const comparar = (uno, otro) => {
        const empatados = huella(uno) === huella(otro) ? cuantosIgual.get(huella(uno)) : 0;
        for (const criterio of settings.tiebreakers) {
          const resultado = porCriterio(criterio, uno, otro, empatados);
          if (resultado !== 0) return resultado;
        }
        // Último recurso, y sólo si la organización lo ha decidido a mano.
        return compararPorResolucion(uno, otro, resoluciones);
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
          scheduledAt: serie.scheduledAt,
          teamA: { teamId: serie.teamAId, name: nombre.get(serie.teamAId) ?? null },
          teamB: { teamId: serie.teamBId, name: nombre.get(serie.teamBId) ?? null },
          winnerTeamId: serie.winnerTeamId,
          games: serie.games.map((juego) => ({
            gameNumber: juego.gameNumber,
            mapKey: juego.mapKey,
            teamARounds: juego.teamARounds,
            teamBRounds: juego.teamBRounds,
            status: juego.status,
            verifiedByCapture: juego.resultSource === 'SCREENSHOT',
            // Sólo lo confirmado. Nada de confianza, texto del OCR ni rutas de
            // archivo: eso es material de administración.
            stats: juego.status === 'COMPLETED'
              ? this.listGameStats(juego.id).map((fila) => ({
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
        maps: this.getMapAnnouncement(eventId).status === 'MAP_POOL_ANNOUNCED'
          ? this.listMaps(eventId).filter((mapa) => mapa.enabled)
          : [],
        mapPolicy: this.getMapAnnouncement(eventId),
        playerStats: this.tournamentPlayerStats(eventId, { stage: null }),
        // Sólo lo justo para poner nombre a las filas de estadísticas: el
        // nombre visible, que ya sale en la página del draft. Ni Riot ID, ni
        // nada de Discord.
        teams: teams.map((equipo) => ({
          id: equipo.id,
          name: equipo.name,
          members: (equipo.members || []).map((miembro) => ({
            participantId: miembro.participantId,
            displayName: miembro.displayName
          }))
        }))
      };
    }
  };

  return store;
}

module.exports = {
  migrateValorantCompetition,
  QUALIFIERS,
  REGENERATE_CONFIRMATION,
  PRIMARY_TIEBREAKER,
  SECONDARY_TIEBREAKERS,
  createValorantCompetitionStore,
  CompetitionError,
  RESULT_SOURCES,
  TIEBREAKERS,
  DEFAULT_MAP_POOL,
  SERIES_STATUSES,
  GAME_STATUSES
};
