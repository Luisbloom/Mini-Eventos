'use strict';

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase } = require('../src/database');
const {
  DEFAULT_TOURNAMENT_INFORMATION,
  InformationValidationError,
  normalizeTournamentInformation
} = require('../src/tournament-information');

describe('tournament information', () => {
  let directory;
  let dbPath;
  let database;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-info-'));
    dbPath = path.join(directory, 'tournament.db');
    database = openDatabase(dbPath);
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('creates complete default information on first access', () => {
    const stored = database.getTournamentInformation();

    assert.deepEqual(stored.information, DEFAULT_TOURNAMENT_INFORMATION);
    assert.equal(typeof stored.updatedAt, 'string');
    assert.equal(stored.information.rules.length, 10);
    assert.equal(stored.information.tiebreakers.length, 5);
    assert.equal(stored.information.faqs.length, 6);
  });

  it('persists an update after closing and reopening SQLite', () => {
    const next = structuredClone(DEFAULT_TOURNAMENT_INFORMATION);
    next.general.intro = 'Texto actualizado por la organizacion.';
    next.general.date = '2026-09-12';
    next.general.time = '19:30';
    next.general.participantCount = 20;
    next.format.groupsEnabled = true;
    next.rules = ['Primera regla', 'Segunda regla'];

    database.updateTournamentInformation(next);
    database.close();
    database = openDatabase(dbPath);
    const stored = database.getTournamentInformation();

    assert.equal(stored.information.general.intro, next.general.intro);
    assert.equal(stored.information.general.participantCount, 20);
    assert.equal(stored.information.format.groupsEnabled, true);
    assert.deepEqual(stored.information.rules, next.rules);
  });

  it('rejects malformed editable information', () => {
    const invalid = structuredClone(DEFAULT_TOURNAMENT_INFORMATION);
    invalid.general.participantCount = -4;
    invalid.faqs = [{ question: '', answer: 'Sin pregunta' }];

    assert.throws(
      () => normalizeTournamentInformation(invalid),
      InformationValidationError
    );
  });

  it('mantiene el contenido largo en Información y no repite los premios', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');
    assert.match(html, /id="formato"/);
    assert.match(html, /id="reglas"/);
    assert.match(html, /id="faq"/);
    assert.match(html, /id="valorant-information-format"/);
    assert.doesNotMatch(html, /id="info-prizes"/);
  });
});
