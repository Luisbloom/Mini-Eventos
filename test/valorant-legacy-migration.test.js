'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const { openDatabase } = require('../src/database');

const FIXTURE = path.join(__dirname, 'fixtures', 'valorant-pre-playoffs-populated.sql');
const TABLES = [
  'events',
  'teams',
  'event_participants',
  'valorant_series',
  'valorant_games',
  'valorant_capture_batches',
  'valorant_captures',
  'valorant_player_game_stats',
  'valorant_settings'
];

function snapshot(connection) {
  return Object.fromEntries(TABLES.map((table) => [
    table,
    connection.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
  ]));
}

function projectRows(rows, columns) {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
}

describe('migración poblada anterior a las eliminatorias', () => {
  const directories = [];

  afterEach(() => {
    directories.splice(0).forEach((directory) => {
      fs.rmSync(directory, { recursive: true, force: true });
    });
  });

  it('conserva datos, relaciones e ids al abrirla dos veces con el código actual', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-valorant-legacy-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'legacy.db');

    const legacy = new BetterSqlite3(databasePath);
    legacy.exec(fs.readFileSync(FIXTURE, 'utf8'));
    legacy.pragma('foreign_keys = ON');

    const legacySnapshot = snapshot(legacy);
    const legacyColumns = Object.fromEntries(TABLES.map((table) => [
      table,
      legacy.pragma(`table_info(${table})`).map((column) => column.name)
    ]));

    assert.equal(legacyColumns.valorant_series.includes('bracket_slot'), false);
    assert.equal(legacyColumns.valorant_settings.includes('grand_final_best_of'), false);
    assert.equal(legacySnapshot.valorant_series.length, 6);
    assert.equal(legacySnapshot.valorant_games.filter((game) => game.status === 'COMPLETED').length, 2);
    assert.equal(legacySnapshot.valorant_player_game_stats.length, 20);
    assert.equal(legacySnapshot.valorant_capture_batches.length, 1);
    assert.equal(legacySnapshot.valorant_captures.length, 2);
    assert.equal(legacySnapshot.valorant_settings.length, 1);
    assert.deepEqual(legacy.pragma('foreign_key_check'), []);
    legacy.close();

    const migrated = openDatabase(databasePath);
    migrated.close();

    const firstOpen = new BetterSqlite3(databasePath);
    firstOpen.pragma('foreign_keys = ON');
    const migratedSnapshot = snapshot(firstOpen);

    for (const table of TABLES) {
      assert.deepEqual(
        projectRows(migratedSnapshot[table], legacyColumns[table]),
        legacySnapshot[table],
        `${table} debe conservar todas sus filas, ids y valores legacy`
      );
    }
    assert.equal(migratedSnapshot.valorant_settings[0].grand_final_best_of, 3);
    assert.deepEqual(firstOpen.pragma('foreign_key_check'), []);
    firstOpen.close();

    const reopened = openDatabase(databasePath);
    reopened.close();

    const secondOpen = new BetterSqlite3(databasePath);
    secondOpen.pragma('foreign_keys = ON');
    assert.deepEqual(snapshot(secondOpen), migratedSnapshot);
    assert.deepEqual(secondOpen.pragma('foreign_key_check'), []);
    secondOpen.close();
  });
});
