'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const {
  DEFAULT_TOURNAMENT_INFORMATION,
  mergeWithDefaults,
  normalizeTournamentInformation
} = require('./tournament-information');

function toMatch(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    receivedAt: row.received_at,
    sourceIp: row.source_ip,
    report: JSON.parse(row.payload_json)
  };
}

function openDatabase(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new TypeError('dbPath debe ser una ruta valida');
  }

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
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
    );

    CREATE INDEX IF NOT EXISTS idx_matches_received_at
      ON matches(received_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS tournament_information (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const insertStatement = connection.prepare(`
    INSERT INTO matches (source_ip, payload_json)
    VALUES (@sourceIp, @payloadJson)
  `);
  const getStatement = connection.prepare(`
    SELECT id, received_at, source_ip, payload_json
    FROM matches
    WHERE id = ?
  `);
  const listStatement = connection.prepare(`
    SELECT id, received_at, source_ip, payload_json
    FROM matches
    ORDER BY id DESC
    LIMIT ?
  `);
  const listAllStatement = connection.prepare(`
    SELECT id, received_at, source_ip, payload_json
    FROM matches
    ORDER BY id ASC
  `);
  const countStatement = connection.prepare('SELECT COUNT(*) AS total FROM matches');
  const pingStatement = connection.prepare('SELECT 1 AS ok');
  const getInformationStatement = connection.prepare(`
    SELECT content_json, updated_at
    FROM tournament_information
    WHERE id = 1
  `);
  const insertDefaultInformationStatement = connection.prepare(`
    INSERT OR IGNORE INTO tournament_information (id, content_json)
    VALUES (1, ?)
  `);
  const updateInformationStatement = connection.prepare(`
    INSERT INTO tournament_information (id, content_json, updated_at)
    VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET
      content_json = excluded.content_json,
      updated_at = excluded.updated_at
  `);

  function readTournamentInformation() {
    insertDefaultInformationStatement.run(JSON.stringify(DEFAULT_TOURNAMENT_INFORMATION));
    const row = getInformationStatement.get();
    return {
      information: mergeWithDefaults(JSON.parse(row.content_json)),
      updatedAt: row.updated_at
    };
  }

  return {
    path: dbPath,

    insertMatch(report, sourceIp = null) {
      const result = insertStatement.run({
        sourceIp,
        payloadJson: JSON.stringify(report)
      });
      return toMatch(getStatement.get(Number(result.lastInsertRowid)));
    },

    getMatch(id) {
      return toMatch(getStatement.get(id));
    },

    listMatches(limit = 50) {
      return listStatement.all(limit).map(toMatch);
    },

    listAllMatches() {
      return listAllStatement.all().map(toMatch);
    },

    countMatches() {
      return countStatement.get().total;
    },

    getTournamentInformation() {
      return readTournamentInformation();
    },

    updateTournamentInformation(content) {
      const normalized = normalizeTournamentInformation(content);
      updateInformationStatement.run(JSON.stringify(normalized));
      return readTournamentInformation();
    },

    ping() {
      return pingStatement.get().ok === 1;
    },

    close() {
      if (connection.open) {
        connection.close();
      }
    }
  };
}

module.exports = { openDatabase };
