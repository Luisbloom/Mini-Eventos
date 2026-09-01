'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const { createCompetitionStore, migrateCompetition } = require('./competition-store');
const { createValorantStore, migrateValorant } = require('./valorant-store');
const { createValorantCompetitionStore, migrateValorantCompetition } = require('./valorant-competition');
const { createValorantCaptureStore } = require('./valorant-captures');
const { createValorantPlayoffStore } = require('./valorant-playoffs');
const { fingerprintReport } = require('./services/report-fingerprint');
const { normalizeFriendCode, describeFriendCode, friendCodeError } = require('./services/friend-code');
const {
  DEFAULT_TOURNAMENT_INFORMATION,
  createDefaultEventInformation,
  mergeWithDefaults,
  normalizeTournamentInformation
} = require('./tournament-information');
const {
  DEFAULT_EVENT,
  DEFAULT_REGISTRATION_FIELDS,
  VALORANT_PROFILE_FIELDS,
  PARTICIPANT_STATUSES,
  EventValidationError,
  normalizeEvent,
  normalizeRegistrationFields,
  normalizeRegistrationValues,
  registrationFieldsForGame, normalizeModules } = require('./events');
const {
  OFFICIAL_VALORANT_FORMAT,
  OFFICIAL_VALORANT_SLUG,
  officialValorantFormatForSlug
} = require('./valorant-event-format');

const OFFICIAL_FORMAT_SYNC_KEY = `event_format:${OFFICIAL_VALORANT_SLUG}:${OFFICIAL_VALORANT_FORMAT.source.version}`;

function toMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    receivedAt: row.received_at,
    sourceIp: row.source_ip,
    stageId: row.stage_id ?? null,
    groupId: row.group_id ?? null,
    hostId: row.host_id ?? null,
    matchNumber: row.match_number ?? null,
    playedAt: row.played_at ?? null,
    matchStatus: row.match_status ?? 'VALID',
    voidReason: row.void_reason ?? null,
    origin: row.origin ?? 'REPORTER',
    submittedBy: row.submitted_by ?? null,
    stageName: row.stage_name ?? null,
    groupName: row.group_name ?? null,
    hostIdentifier: row.host_identifier ?? null,
    hostName: row.host_name ?? null,
    report: JSON.parse(row.payload_json)
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function toField(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    key: row.field_key,
    label: row.label,
    type: row.field_type,
    required: Boolean(row.required),
    placeholder: row.placeholder,
    options: JSON.parse(row.options_json),
    position: row.position,
    enabled: Boolean(row.enabled)
  };
}

function registrationAvailability(event, now = new Date()) {
  if (event.archived || !event.modules.registration || !event.registrationsOpen) {
    return { available: false, code: 'CLOSED', label: 'Inscripciones cerradas' };
  }
  if (event.registrationOpensAt && now < new Date(event.registrationOpensAt)) {
    return { available: false, code: 'NOT_OPEN_YET', label: 'Próximamente' };
  }
  if (event.registrationClosesAt && now >= new Date(event.registrationClosesAt)) {
    return { available: false, code: 'CLOSED', label: 'Inscripciones cerradas' };
  }
  if (event.maxParticipants !== null && event.participantCount >= event.maxParticipants) {
    return { available: false, code: 'FULL', label: 'Inscripciones completas' };
  }
  return { available: true, code: 'OPEN', label: 'Inscripciones abiertas' };
}

function toEvent(row) {
  if (!row) return null;
  const event = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    game: row.game,
    description: row.description,
    status: row.status,
    startsAt: row.starts_at,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    minParticipants: row.min_participants,
    maxParticipants: row.max_participants,
    registrationsOpen: Boolean(row.registrations_open),
    archived: Boolean(row.archived),
    modules: normalizeModules(JSON.parse(row.modules_json)),
    accentColor: row.accent_color,
    icon: row.icon,
    coverImage: row.cover_image,
    bannerImage: row.banner_image ?? null,
    participantCount: Number(row.participant_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  event.registration = registrationAvailability(event);
  return event;
}

function toParticipant(row, { publicView = false } = {}) {
  const values = JSON.parse(row.field_values_json);
  const participant = {
    id: row.id,
    eventId: row.event_id,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (!publicView) {
    participant.discordUsername = row.discord_username;
    participant.values = values;
    participant.internalFriendCode = row.internal_friend_code;
    participant.consentAt = row.consent_at ?? null;
    participant.consentVersion = row.consent_version ?? null;
  }
  return participant;
}

function openDatabase(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') throw new TypeError('dbPath debe ser una ruta valida');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const connection = new BetterSqlite3(dbPath);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      source_ip TEXT,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      report_fingerprint TEXT CHECK (report_fingerprint IS NULL OR (length(report_fingerprint)=64 AND report_fingerprint NOT GLOB '*[^0-9a-f]*'))
    );
    CREATE TABLE IF NOT EXISTS tournament_information (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  connection.prepare('INSERT OR IGNORE INTO tournament_information (id, content_json) VALUES (1, ?)')
    .run(JSON.stringify(DEFAULT_TOURNAMENT_INFORMATION));

  connection.transaction(() => {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        starts_at TEXT,
        registration_opens_at TEXT,
        registration_closes_at TEXT,
        min_participants INTEGER CHECK (min_participants IS NULL OR min_participants > 0),
        max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0),
        registrations_open INTEGER NOT NULL DEFAULT 0 CHECK (registrations_open IN (0, 1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        modules_json TEXT NOT NULL CHECK (json_valid(modules_json)),
        accent_color TEXT NOT NULL DEFAULT '#d7ff3f',
        icon TEXT NOT NULL DEFAULT 'gamepad',
        cover_image TEXT NOT NULL DEFAULT '/images/events/default-event-cover.jpg',
        banner_image TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL CHECK (json_valid(value_json))
      );
      CREATE TABLE IF NOT EXISTS event_information (
        event_id INTEGER PRIMARY KEY,
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_registration_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        field_key TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK (field_type IN ('text', 'select', 'checkbox')),
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
        placeholder TEXT NOT NULL DEFAULT '',
        options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
        position INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        UNIQUE (event_id, field_key),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        discord_username TEXT NOT NULL COLLATE NOCASE,
        display_name TEXT NOT NULL,
        field_values_json TEXT NOT NULL CHECK (json_valid(field_values_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'absent', 'disqualified')),
        internal_friend_code TEXT,
        -- Cuándo aceptó los términos y la política, y qué versión aceptó. Sin
        -- esto la política afirma un consentimiento que nadie puede demostrar.
        consent_at TEXT,
        consent_version TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (event_id, discord_username),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS match_report_ids (
        event_id INTEGER NOT NULL,
        report_id TEXT NOT NULL,
        match_id INTEGER NOT NULL UNIQUE,
        PRIMARY KEY (event_id, report_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
      );
    `);
    if (!connection.pragma('table_info(matches)').some((column) => column.name === 'event_id')) {
      connection.exec('ALTER TABLE matches ADD COLUMN event_id INTEGER');
    }
    /*
      Los inscritos anteriores a esto se quedan sin fecha de consentimiento:
      no se inventa una. NULL dice «se apuntó antes de que se registrara», que
      es la verdad; una fecha falsa sería peor que no tenerla.
    */
    const participantColumns = connection.pragma('table_info(event_participants)').map((c) => c.name);
    if (!participantColumns.includes('consent_at')) {
      connection.exec('ALTER TABLE event_participants ADD COLUMN consent_at TEXT');
    }
    if (!participantColumns.includes('consent_version')) {
      connection.exec('ALTER TABLE event_participants ADD COLUMN consent_version TEXT');
    }

    const eventColumns = connection.pragma('table_info(events)');
    const needsMinimumMigration = !eventColumns.some((column) => column.name === 'min_participants');
    const needsCoverMigration = !eventColumns.some((column) => column.name === 'cover_image');
    const needsBannerMigration = !eventColumns.some((column) => column.name === 'banner_image');
    if (needsMinimumMigration) {
      connection.exec('ALTER TABLE events ADD COLUMN min_participants INTEGER');
    }
    if (needsCoverMigration) {
      connection.exec("ALTER TABLE events ADD COLUMN cover_image TEXT NOT NULL DEFAULT '/images/events/default-event-cover.jpg'");
    }
    if (needsBannerMigration) {
      connection.exec('ALTER TABLE events ADD COLUMN banner_image TEXT');
    }
    /*
      La portada por defecto pasó de PNG a JPEG: pesaba 2,2 MB y era lo primero
      que descargaba quien entraba. Los eventos que apuntaban al fichero viejo
      se quedarían sin imagen, así que se les cambia la ruta.
    */
    connection.exec(`UPDATE events SET cover_image='/images/events/default-event-cover.jpg'
      WHERE cover_image='/images/events/default-event-cover.png'`);
    connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_matches_received_at ON matches(received_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_matches_event_received ON matches(event_id, received_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_matches_event_report_id ON matches(event_id, json_extract(payload_json, '$.reportId'))
        WHERE json_extract(payload_json, '$.reportId') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_participants_event_status ON event_participants(event_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_fields_event_position ON event_registration_fields(event_id, position, id);
    `);

    const initial = normalizeEvent(DEFAULT_EVENT);
    const insertInitialEvent = connection.prepare(`
      INSERT OR IGNORE INTO events (
        slug, name, game, description, status, starts_at, registration_opens_at,
        registration_closes_at, min_participants, max_participants, registrations_open, archived,
        modules_json, accent_color, icon, cover_image, banner_image
      ) VALUES (
        @slug, @name, @game, @description, @status, @startsAt, @registrationOpensAt,
        @registrationClosesAt, @minParticipants, @maxParticipants, @registrationsOpen, @archived,
        @modulesJson, @accentColor, @icon, @coverImage, @bannerImage
      )
    `);
    const defaultSetting = connection.prepare("SELECT value_json FROM app_settings WHERE setting_key = 'default_event_id'").get();
    let eventId = defaultSetting ? Number(JSON.parse(defaultSetting.value_json)) : null;
    if (!eventId || !connection.prepare('SELECT id FROM events WHERE id = ?').get(eventId)) {
      insertInitialEvent.run({ ...initial, registrationsOpen: Number(initial.registrationsOpen), archived: Number(initial.archived), modulesJson: JSON.stringify(initial.modules) });
      eventId = connection.prepare('SELECT id FROM events WHERE slug = ?').get(DEFAULT_EVENT.slug).id;
      connection.prepare(`INSERT INTO app_settings (setting_key, value_json) VALUES ('default_event_id', ?)
        ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify(eventId));
    }
    if (needsMinimumMigration) {
      connection.prepare('UPDATE events SET min_participants = ? WHERE id = ?')
        .run(DEFAULT_EVENT.minParticipants, eventId);
    }
    if (needsCoverMigration) {
      connection.prepare('UPDATE events SET cover_image = ? WHERE id = ?')
        .run(DEFAULT_EVENT.coverImage, eventId);
    }
    if (needsBannerMigration) {
      connection.prepare('UPDATE events SET banner_image = ? WHERE id = ?')
        .run(DEFAULT_EVENT.bannerImage, eventId);
    }
    connection.prepare(`
      INSERT OR IGNORE INTO event_information (event_id, content_json, updated_at)
      SELECT ?, content_json, updated_at FROM tournament_information WHERE id = 1
    `).run(eventId);
    connection.prepare('UPDATE matches SET event_id = ? WHERE event_id IS NULL').run(eventId);
    connection.exec(`INSERT OR IGNORE INTO match_report_ids (event_id, report_id, match_id)
      SELECT event_id, trim(CAST(json_extract(payload_json, '$.reportId') AS TEXT)), MIN(id)
      FROM matches
      WHERE event_id IS NOT NULL
        AND json_type(payload_json, '$.reportId') = 'text'
        AND trim(CAST(json_extract(payload_json, '$.reportId') AS TEXT)) <> ''
      GROUP BY event_id, trim(CAST(json_extract(payload_json, '$.reportId') AS TEXT))`);
    const insertSeedField = connection.prepare(`
      INSERT OR IGNORE INTO event_registration_fields
        (event_id, field_key, label, field_type, required, placeholder, options_json, position, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const field of DEFAULT_REGISTRATION_FIELDS) {
      insertSeedField.run(eventId, field.key, field.label, field.type, Number(field.required), field.placeholder, JSON.stringify(field.options), field.position, Number(field.enabled));
    }

    // Sincronización única del evento real con el documento oficial. El
    // alcance es deliberadamente estrecho: no toca participantes, equipos,
    // resultados, archivos ni ningún otro evento.
    const officialEvent = connection.prepare('SELECT id, modules_json FROM events WHERE slug=?')
      .get(OFFICIAL_VALORANT_SLUG);
    const alreadySynced = connection.prepare('SELECT 1 FROM app_settings WHERE setting_key=?')
      .get(OFFICIAL_FORMAT_SYNC_KEY);
    if (officialEvent && !alreadySynced) {
      const modules = normalizeModules(JSON.parse(officialEvent.modules_json));
      for (const key of ['information', 'participants', 'matches', 'registration', 'competition', 'schedule', 'draft']) {
        modules[key] = true;
      }
      connection.prepare(`UPDATE events
        SET status='Próximamente', min_participants=?, max_participants=?,
            registrations_open=0, archived=0, modules_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?`).run(
        OFFICIAL_VALORANT_FORMAT.players,
        OFFICIAL_VALORANT_FORMAT.players,
        JSON.stringify(modules),
        officialEvent.id
      );
      connection.prepare('INSERT INTO app_settings (setting_key,value_json) VALUES (?,?)')
        .run(OFFICIAL_FORMAT_SYNC_KEY, JSON.stringify({ syncedAt: new Date().toISOString() }));
    }
  })();

  // Los eventos creados antes de que existiera el campo de Friend Code no lo
  // tienen en su formulario, y sin él nadie puede identificarse solo. Se añade
  // una única vez: si después el administrador decide quitarlo, no vuelve.
  connection.transaction(() => {
    const migrated = connection
      .prepare("SELECT 1 FROM app_settings WHERE setting_key='friend_code_field_v1'")
      .get();
    if (migrated) return;
    const field = DEFAULT_REGISTRATION_FIELDS.find((item) => item.key === 'friend_code');
    if (field) {
      const insert = connection.prepare(`
        INSERT OR IGNORE INTO event_registration_fields
          (event_id, field_key, label, field_type, required, placeholder, options_json, position, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const lastPosition = connection.prepare(
        'SELECT COALESCE(MAX(position),0) AS position FROM event_registration_fields WHERE event_id=?'
      );
      const eventos = connection.prepare('SELECT id, game FROM events').all()
        .filter((row) => registrationFieldsForGame(row.game).some((item) => item.key === 'friend_code'));
      for (const row of eventos) {
        insert.run(row.id, field.key, field.label, field.type, Number(field.required),
          field.placeholder, JSON.stringify(field.options),
          lastPosition.get(row.id).position + 1, Number(field.enabled));
      }
    }
    connection.prepare("INSERT INTO app_settings (setting_key, value_json) VALUES ('friend_code_field_v1', 'true')").run();
  })();

  // Añade una sola vez el perfil opcional a los eventos de Valorant que ya
  // existían. INSERT OR IGNORE conserva cualquier campo creado previamente.
  connection.transaction(() => {
    const migrationKey = 'valorant_profile_fields_v1';
    if (connection.prepare('SELECT 1 FROM app_settings WHERE setting_key=?').get(migrationKey)) return;
    const insert = connection.prepare(`
      INSERT OR IGNORE INTO event_registration_fields
        (event_id, field_key, label, field_type, required, placeholder, options_json, position, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const lastPosition = connection.prepare(
      'SELECT COALESCE(MAX(position),0) AS position FROM event_registration_fields WHERE event_id=?'
    );
    for (const event of connection.prepare("SELECT id FROM events WHERE lower(trim(game))='valorant'").all()) {
      let position = lastPosition.get(event.id).position;
      for (const field of VALORANT_PROFILE_FIELDS) {
        position += 1;
        insert.run(event.id, field.key, field.label, field.type, Number(field.required),
          field.placeholder, JSON.stringify(field.options), position, Number(field.enabled));
      }
    }
    connection.prepare('INSERT INTO app_settings (setting_key,value_json) VALUES (?,?)')
      .run(migrationKey, 'true');
  })();

  const competitionDefaultId = Number(JSON.parse(
    connection.prepare("SELECT value_json FROM app_settings WHERE setting_key='default_event_id'").get().value_json
  ));
  try {
    migrateCompetition(connection, competitionDefaultId);
    migrateValorant(connection);
    migrateValorantCompetition(connection);
  } catch (error) {
    if (connection.open) connection.close();
    throw error;
  }

  const EVENT_SELECT = `SELECT e.*,
    (SELECT COUNT(*) FROM event_participants p WHERE p.event_id=e.id AND p.status IN ('pending','confirmed')) AS participant_count
    FROM events e`;
  const getEventBySlugStatement = connection.prepare(`${EVENT_SELECT} WHERE e.slug = ?`);
  const getEventByIdStatement = connection.prepare(`${EVENT_SELECT} WHERE e.id = ?`);
  const listEventsStatement = connection.prepare(`${EVENT_SELECT}
    WHERE (? = 1 OR e.archived = 0)
    ORDER BY e.archived ASC,
      CASE e.status WHEN 'En curso' THEN 0 WHEN 'Inscripciones abiertas' THEN 1 WHEN 'Próximamente' THEN 2
        WHEN 'Inscripciones cerradas' THEN 3 WHEN 'Finalizado' THEN 4 WHEN 'Cancelado' THEN 5 ELSE 6 END,
      CASE WHEN e.starts_at IS NULL THEN 1 ELSE 0 END, e.starts_at ASC, e.id DESC`);
  const insertEventStatement = connection.prepare(`INSERT INTO events
    (slug,name,game,description,status,starts_at,registration_opens_at,registration_closes_at,min_participants,max_participants,registrations_open,archived,modules_json,accent_color,icon,cover_image,banner_image)
    VALUES (@slug,@name,@game,@description,@status,@startsAt,@registrationOpensAt,@registrationClosesAt,@minParticipants,@maxParticipants,@registrationsOpen,@archived,@modulesJson,@accentColor,@icon,@coverImage,@bannerImage)`);
  const updateEventStatement = connection.prepare(`UPDATE events SET
    slug=@slug,name=@name,game=@game,description=@description,status=@status,starts_at=@startsAt,
    registration_opens_at=@registrationOpensAt,registration_closes_at=@registrationClosesAt,
    min_participants=@minParticipants,max_participants=@maxParticipants,registrations_open=@registrationsOpen,archived=@archived,
    modules_json=@modulesJson,accent_color=@accentColor,icon=@icon,cover_image=@coverImage,banner_image=@bannerImage,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`);
  const insertInformationStatement = connection.prepare('INSERT OR IGNORE INTO event_information (event_id,content_json) VALUES (?,?)');
  const getInformationStatement = connection.prepare('SELECT content_json,updated_at FROM event_information WHERE event_id=?');
  const updateInformationStatement = connection.prepare(`INSERT INTO event_information (event_id,content_json,updated_at)
    VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(event_id) DO UPDATE SET content_json=excluded.content_json,updated_at=excluded.updated_at`);
  const insertFieldStatement = connection.prepare(`INSERT INTO event_registration_fields
    (event_id,field_key,label,field_type,required,placeholder,options_json,position,enabled) VALUES (?,?,?,?,?,?,?,?,?)`);
  const getFieldsStatement = connection.prepare(`SELECT * FROM event_registration_fields WHERE event_id=? AND (?=0 OR enabled=1) ORDER BY position,id`);
  const deleteFieldsStatement = connection.prepare('DELETE FROM event_registration_fields WHERE event_id=?');
  const insertMatchStatement = connection.prepare(`INSERT INTO matches
    (event_id,source_ip,payload_json,report_fingerprint,stage_id,group_id,host_id,match_number,played_at,match_status,origin,submitted_by)
    VALUES (@eventId,@sourceIp,@payloadJson,@reportFingerprint,@stageId,@groupId,@hostId,@matchNumber,@playedAt,'VALID',@origin,@submittedBy)`);
  const findMatchByReportIdStatement = connection.prepare(`SELECT m.* FROM match_report_ids r
    JOIN matches m ON m.id=r.match_id WHERE r.event_id=? AND r.report_id=?`);
  const insertMatchReportIdStatement = connection.prepare('INSERT INTO match_report_ids (event_id,report_id,match_id) VALUES (?,?,?)');
  const getMatchStatement = connection.prepare('SELECT * FROM matches WHERE id=?');
  const listMatchesStatement = connection.prepare(`SELECT m.*,
    s.name AS stage_name,
    g.name AS group_name,
    h.identifier AS host_identifier,
    h.name AS host_name
    FROM matches m
    LEFT JOIN event_stages s ON s.id=m.stage_id AND s.event_id=m.event_id
    LEFT JOIN event_groups g ON g.id=m.group_id AND g.event_id=m.event_id AND g.stage_id=m.stage_id
    LEFT JOIN event_hosts h ON h.id=m.host_id AND h.event_id=m.event_id
    WHERE m.event_id=? ORDER BY m.id DESC LIMIT ?`);
  const listAllMatchesStatement = connection.prepare('SELECT * FROM matches WHERE event_id=? ORDER BY id ASC');
  const countMatchesStatement = connection.prepare('SELECT COUNT(*) total FROM matches WHERE event_id=?');
  const deleteMatchStatement = connection.prepare('DELETE FROM matches WHERE id=? AND event_id=?');
  const voidMatchStatement = connection.prepare("UPDATE matches SET match_status='VOID',void_reason=? WHERE id=? AND event_id=?");
  const countActiveParticipantsStatement = connection.prepare(`SELECT COUNT(*) total FROM event_participants WHERE event_id=? AND status IN ('pending','confirmed')`);
  const countConfirmedParticipantsStatement = connection.prepare("SELECT COUNT(*) total FROM event_participants WHERE event_id=? AND status='confirmed'");
  const duplicateParticipantStatement = connection.prepare('SELECT id FROM event_participants WHERE event_id=? AND discord_username=? COLLATE NOCASE');
  const duplicateFriendCodeStatement = connection.prepare(
    "SELECT id FROM event_participants WHERE event_id=? AND internal_friend_code=? AND status!='cancelled' AND id IS NOT ?");
  const insertParticipantStatement = connection.prepare(`INSERT INTO event_participants (event_id,discord_username,display_name,field_values_json,internal_friend_code,consent_at,consent_version) VALUES (?,?,?,?,?,?,?)`);
  const getParticipantStatement = connection.prepare('SELECT * FROM event_participants WHERE id=?');
  const listParticipantsStatement = connection.prepare('SELECT * FROM event_participants WHERE event_id=? ORDER BY created_at,id');
  /*
    Por orden de inscripción, no alfabético. Quien se apuntó primero aparece
    primero: en un torneo con plazas contadas eso importa, y el orden
    alfabético premiaba llamarse Ana.
  */
  const listPublicParticipantsStatement = connection.prepare(`SELECT * FROM event_participants WHERE event_id=? AND status='confirmed' ORDER BY created_at,id`);
  const updateParticipantStatement = connection.prepare(`UPDATE event_participants SET status=?,internal_friend_code=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`);
  const deleteParticipantStatement = connection.prepare('DELETE FROM event_participants WHERE id=?');
  const pingStatement = connection.prepare('SELECT 1 ok');
  const getDefaultEventIdStatement = connection.prepare("SELECT value_json FROM app_settings WHERE setting_key='default_event_id'");

  function requireEvent(idOrSlug) {
    const event = typeof idOrSlug === 'number' ? toEvent(getEventByIdStatement.get(idOrSlug)) : toEvent(getEventBySlugStatement.get(idOrSlug));
    if (!event) throw new EventValidationError('El evento no existe.', 'EVENT_NOT_FOUND', 404);
    return event;
  }
  function defaultEvent() {
    const setting = getDefaultEventIdStatement.get();
    return requireEvent(Number(JSON.parse(setting.value_json)));
  }
  function insertFields(eventId, fields) {
    for (const field of fields) {
      insertFieldStatement.run(eventId, field.key, field.label, field.type, Number(field.required), field.placeholder, JSON.stringify(field.options), field.position, Number(field.enabled));
    }
  }
  const createEventTransaction = connection.transaction((input) => {
    const official = officialValorantFormatForSlug(input?.slug);
    const event = normalizeEvent(official ? {
      ...input,
      minParticipants: official.minPlayers,
      maxParticipants: official.maxPlayers
    } : input);
    let result;
    try {
      result = insertEventStatement.run({ ...event, registrationsOpen: Number(event.registrationsOpen), archived: Number(event.archived), modulesJson: JSON.stringify(event.modules) });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new EventValidationError('Ya existe un evento con ese slug.', 'EVENT_SLUG_EXISTS', 409);
      throw error;
    }
    const id = Number(result.lastInsertRowid);
    if (official) {
      connection.prepare(`INSERT OR IGNORE INTO app_settings (setting_key,value_json) VALUES (?,?)`)
        .run(OFFICIAL_FORMAT_SYNC_KEY, JSON.stringify({ createdAlignedAt: new Date().toISOString() }));
    }
    insertInformationStatement.run(id, JSON.stringify(createDefaultEventInformation(event.game)));
    const fields = registrationFieldsForGame(event.game).map((field) => ({
      ...field,
      label: field.key === 'game_name' ? `Nombre en ${event.game}` : field.label,
      placeholder: field.key === 'game_name' ? `Tu nombre en ${event.game}` : field.placeholder
    }));
    insertFields(id, normalizeRegistrationFields(fields));
    return id;
  });
  const replaceFieldsTransaction = connection.transaction((eventId, fields) => {
    requireEvent(eventId);
    const normalized = normalizeRegistrationFields(fields);
    deleteFieldsStatement.run(eventId);
    insertFields(eventId, normalized);
  });
  const insertMatchTransaction = connection.transaction((eventId, report, sourceIp, context = {}) => {
    const reportId = typeof report?.reportId === 'string' ? report.reportId.trim() : '';
    const normalizedReport = reportId ? { ...report, reportId } : report;
    const reportFingerprint = context.reportFingerprint || fingerprintReport(normalizedReport);
    if (!/^[a-f0-9]{64}$/.test(reportFingerprint)) {
      throw new EventValidationError('La huella de idempotencia no es válida.', 'REPORT_FINGERPRINT_INVALID');
    }
    if (reportId) {
      const existing = findMatchByReportIdStatement.get(eventId, reportId);
      if (existing) {
        const stored = toMatch(existing);
        const sameScope = stored.stageId === (context.stageId ? Number(context.stageId) : null)
          && stored.groupId === (context.groupId ? Number(context.groupId) : null)
          && stored.hostId === (context.hostId ? Number(context.hostId) : null)
          && stored.matchNumber === (context.matchNumber ? Number(context.matchNumber) : null);
        const samePayload = existing.report_fingerprint
          ? existing.report_fingerprint === reportFingerprint
          : JSON.stringify(stableJson(stored.report)) === JSON.stringify(stableJson(normalizedReport));
        if (!sameScope || !samePayload) {
          throw new EventValidationError('reportId ya identifica un resultado diferente.', 'REPORT_ID_CONFLICT', 409);
        }
        return { ...stored, duplicate: true };
      }
    }
    let result;
    try {
      result = insertMatchStatement.run({
        eventId,
        sourceIp,
        payloadJson: JSON.stringify(normalizedReport),
        reportFingerprint,
        stageId: context.stageId || null,
        groupId: context.groupId || null,
        hostId: context.hostId || null,
        matchNumber: context.matchNumber || null,
        playedAt: context.playedAt || null,
        origin: context.origin || 'REPORTER',
        submittedBy: context.submittedBy || null
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(error.message).includes('ux_matches_competitive_slot')) {
        const occupied = new EventValidationError(
          'Ese número de partida ya tiene un resultado válido. Anúlalo antes de reenviarlo.',
          'MATCH_SLOT_OCCUPIED',
          409
        );
        throw occupied;
      }
      throw error;
    }
    const matchId = Number(result.lastInsertRowid);
    if (reportId) insertMatchReportIdStatement.run(eventId, reportId, matchId);
    return { ...toMatch(getMatchStatement.get(matchId)), duplicate: false };
  });

  const competition = createCompetitionStore(connection);
  const valorant = createValorantStore(connection);
  // La competición comparte el registro de auditoría del draft.
  const valorantCompetition = createValorantCompetitionStore(connection, {
    audit: (...args) => valorant.recordAudit(...args)
  });
  const valorantCaptures = createValorantCaptureStore(connection, {
    audit: (...args) => valorant.recordAudit(...args)
  });
  const valorantPlayoffs = createValorantPlayoffStore(connection, {
    audit: (...args) => valorant.recordAudit(...args),
    competition: valorantCompetition
  });
  // Un resultado de eliminatoria entra por el mismo sitio que los demás; lo que
  // cambia es que además mueve el cuadro.
  valorantCompetition.attachPlayoffs(valorantPlayoffs);
  return {
    path: dbPath,
    getDefaultEvent: defaultEvent,
    getEventBySlug(slug) { return toEvent(getEventBySlugStatement.get(slug)); },
    getEventById(id) { return toEvent(getEventByIdStatement.get(id)); },
    listEvents({ includeArchived = false } = {}) { return listEventsStatement.all(Number(includeArchived)).map(toEvent); },
    createEvent(input) { return toEvent(getEventByIdStatement.get(createEventTransaction(input))); },
    updateEvent(id, input) {
      const event = normalizeEvent(input, requireEvent(id));
      try {
        updateEventStatement.run({ id, ...event, registrationsOpen: Number(event.registrationsOpen), archived: Number(event.archived), modulesJson: JSON.stringify(event.modules) });
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new EventValidationError('Ya existe un evento con ese slug.', 'EVENT_SLUG_EXISTS', 409);
        throw error;
      }
      return requireEvent(id);
    },
    archiveEvent(id) { return this.updateEvent(id, { archived: true }); },
    listRegistrationFields(eventId, { publicOnly = false } = {}) {
      requireEvent(eventId);
      return getFieldsStatement.all(eventId, Number(publicOnly)).map(toField);
    },
    replaceRegistrationFields(eventId, fields) {
      replaceFieldsTransaction(eventId, fields);
      return this.listRegistrationFields(eventId);
    },
    createParticipant(eventId, rawValues, consent = null) {
      const event = requireEvent(eventId);
      event.participantCount = countActiveParticipantsStatement.get(eventId).total;
      const availability = registrationAvailability(event);
      if (!availability.available) {
        throw new EventValidationError(availability.label, `REGISTRATION_${availability.code}`, availability.code === 'FULL' ? 409 : 403);
      }
      const values = normalizeRegistrationValues(getFieldsStatement.all(eventId, 1).map(toField), rawValues);
      const discordUsername = values.discord_username;
      if (duplicateParticipantStatement.get(eventId, discordUsername)) {
        throw new EventValidationError('Ese usuario de Discord ya está inscrito en este evento.', 'ALREADY_REGISTERED', 409);
      }
      const preferredNameKey = Object.keys(values).find((key) => key !== 'discord_username' && key !== 'same_as_discord' && typeof values[key] === 'string' && values[key]);
      const displayName = values.game_name || (preferredNameKey ? values[preferredNameKey] : discordUsername);
      // El Friend Code que escribe el jugador pasa directo a su identidad interna:
      // así el Reporter puede reconocerlo sin que nadie lo teclee a mano en /admin.
      // El Friend Code sólo se exige donde el evento lo pide (Among Us). Un
      // código mal escrito no falla en ninguna parte: la persona juega y sus
      // partidas no se le cuentan, así que se rechaza aquí y no más tarde.
      let friendCode = null;
      if (Object.prototype.hasOwnProperty.call(values, 'friend_code')) {
        const check = describeFriendCode(values.friend_code);
        if (!check.ok) throw new EventValidationError(friendCodeError(check.code), 'INVALID_FRIEND_CODE');
        friendCode = check.normalized;
        if (duplicateFriendCodeStatement.get(eventId, friendCode, null)) {
          throw new EventValidationError('Ese Friend Code ya está inscrito en este evento.', 'FRIEND_CODE_TAKEN', 409);
        }
      }
      const result = insertParticipantStatement.run(
        eventId, discordUsername, displayName, JSON.stringify(values), friendCode,
        consent?.acceptedAt ?? null, consent?.version ?? null);
      return toParticipant(getParticipantStatement.get(Number(result.lastInsertRowid)));
    },
    /** Sólo los confirmados: son los que deciden si el torneo se puede jugar. */
    countConfirmedParticipants(eventId) {
      return countConfirmedParticipantsStatement.get(eventId).total;
    },
    listParticipants(eventId, { publicView = false } = {}) {
      requireEvent(eventId);
      const rows = publicView ? listPublicParticipantsStatement.all(eventId) : listParticipantsStatement.all(eventId);
      // El número de orden se calcula de la lista ya ordenada: guardarlo sería
      // otro dato que mantener y que puede discrepar de las fechas.
      return rows.map((row, indice) => ({
        ...toParticipant(row, { publicView }),
        registrationOrder: indice + 1
      }));
    },
    updateParticipant(id, changes = {}) {
      const row = getParticipantStatement.get(id);
      if (!row) throw new EventValidationError('La inscripción no existe.', 'PARTICIPANT_NOT_FOUND', 404);
      const status = changes.status ?? row.status;
      if (!PARTICIPANT_STATUSES.includes(status)) throw new EventValidationError('El estado del participante no es válido.', 'INVALID_PARTICIPANT');
      // Se valida sólo cuando cambia: si no, confirmar o descalificar a alguien
      // que ya tenía un código antiguo mal escrito quedaría bloqueado.
      let friendCode = row.internal_friend_code;
      if (changes.internalFriendCode !== undefined) {
        const raw = String(changes.internalFriendCode ?? '').trim();
        if (!raw) friendCode = null;
        else {
          const check = describeFriendCode(raw);
          if (!check.ok) throw new EventValidationError(friendCodeError(check.code), 'INVALID_FRIEND_CODE');
          if (duplicateFriendCodeStatement.get(row.event_id, check.normalized, id)) {
            throw new EventValidationError('Ese Friend Code ya está inscrito en este evento.', 'FRIEND_CODE_TAKEN', 409);
          }
          friendCode = check.normalized;
        }
      }
      if (friendCode && friendCode.length > 120) throw new EventValidationError('El Friend Code es demasiado largo.', 'INVALID_PARTICIPANT');
      connection.transaction(()=>{updateParticipantStatement.run(status,friendCode,id);if(status==='disqualified')connection.prepare("UPDATE stage_participants SET competitive_status='disqualified' WHERE participant_id=? AND stage_id IN (SELECT id FROM event_stages WHERE status!='completed')").run(id);else if(status==='confirmed'&&row.status==='disqualified')connection.prepare("UPDATE stage_participants SET competitive_status=CASE WHEN advanced_from_stage_id IS NULL THEN 'competing' ELSE 'finalist' END WHERE participant_id=? AND competitive_status='disqualified' AND stage_id IN (SELECT id FROM event_stages WHERE status!='completed')").run(id);})();
      return toParticipant(getParticipantStatement.get(id));
    },
    deleteParticipant(id) { return deleteParticipantStatement.run(id).changes > 0; },
    insertMatch(report, sourceIp = null, eventId = null, context = {}) {
      const event = requireEvent(eventId || defaultEvent().id);
      return insertMatchTransaction(event.id, report, sourceIp, context);
    },
    findMatchByReportId(eventId, reportId) {
      const normalizedReportId = typeof reportId === 'string' ? reportId.trim() : '';
      return normalizedReportId ? toMatch(findMatchByReportIdStatement.get(Number(eventId), normalizedReportId)) : null;
    },
    getMatchReportFingerprint(id) {
      return getMatchStatement.get(Number(id))?.report_fingerprint ?? null;
    },
    getMatch(id) { return toMatch(getMatchStatement.get(id)); },
    listMatches(limit = 50, eventId = null) { return listMatchesStatement.all(eventId || defaultEvent().id, limit).map(toMatch); },
    listAllMatches(eventId = null) { return listAllMatchesStatement.all(eventId || defaultEvent().id).map(toMatch); },
    countMatches(eventId = null) { return countMatchesStatement.get(eventId || defaultEvent().id).total; },
    deleteMatch(id, eventId) { return deleteMatchStatement.run(id, eventId).changes > 0; },
    voidMatch(id, eventId, reason) {
      const text = String(reason || '').trim();
      if (!text) throw new EventValidationError('El motivo de anulación es obligatorio.', 'VOID_REASON_REQUIRED');
      return voidMatchStatement.run(text, id, eventId).changes > 0;
    },
    getTournamentInformation(eventId = null) {
      const id = eventId || defaultEvent().id;
      requireEvent(id);
      insertInformationStatement.run(id, JSON.stringify(DEFAULT_TOURNAMENT_INFORMATION));
      const row = getInformationStatement.get(id);
      return { information: mergeWithDefaults(JSON.parse(row.content_json)), updatedAt: row.updated_at };
    },
    updateTournamentInformation(content, eventId = null) {
      const id = eventId || defaultEvent().id;
      requireEvent(id);
      updateInformationStatement.run(id, JSON.stringify(normalizeTournamentInformation(content)));
      return this.getTournamentInformation(id);
    },
    competition,
    valorant,
    valorantCompetition,
    valorantCaptures,
    valorantPlayoffs,
    ping() { return pingStatement.get().ok === 1; },
    close() { if (connection.open) connection.close(); }
  };
}

module.exports = { openDatabase, registrationAvailability };
