'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const { openDatabase } = require('../src/database');
const { DEFAULT_TOURNAMENT_INFORMATION } = require('../src/tournament-information');

describe('multi-event database', () => {
  const directories = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryPath() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-events-'));
    directories.push(directory);
    return path.join(directory, 'tournament.db');
  }

  it('migrates the legacy tournament without losing matches or information', () => {
    const dbPath = temporaryPath();
    const legacy = new BetterSqlite3(dbPath);
    legacy.exec(`
      CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        source_ip TEXT,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      );
      CREATE TABLE tournament_information (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        updated_at TEXT NOT NULL
      );
    `);
    const information = structuredClone(DEFAULT_TOURNAMENT_INFORMATION);
    information.general.intro = 'Información histórica que debe conservarse.';
    legacy.prepare('INSERT INTO matches (received_at, source_ip, payload_json) VALUES (?, ?, ?)')
      .run('2026-08-20T18:00:00.000Z', '192.168.1.20', JSON.stringify({ reportId: 'legacy-1' }));
    legacy.prepare('INSERT INTO tournament_information VALUES (1, ?, ?)')
      .run(JSON.stringify(information), '2026-08-20T17:00:00.000Z');
    legacy.close();

    const database = openDatabase(dbPath);
    const event = database.getEventBySlug('among-us-agosto-2026');
    const matches = database.listAllMatches(event.id);
    const migratedInformation = database.getTournamentInformation(event.id);
    const legacyRaw = new BetterSqlite3(dbPath, { readonly: true });
    assert.equal(legacyRaw.prepare('SELECT report_fingerprint fingerprint FROM matches WHERE id=?').get(matches[0].id).fingerprint, null);
    legacyRaw.close();

    assert.equal(event.name, 'Torneo Among Us');
    assert.equal(event.minParticipants, 20);
    assert.equal(event.coverImage, '/images/events/among-us-cover.jpg');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].eventId, event.id);
    assert.equal(matches[0].report.reportId, 'legacy-1');
    const legacyReplay=database.insertMatch({reportId:'legacy-1'},null,event.id);
    assert.equal(legacyReplay.duplicate,true);
    assert.throws(()=>database.insertMatch({reportId:'legacy-1',map:'Polus'},null,event.id),(error)=>error.code==='REPORT_ID_CONFLICT');
    assert.throws(()=>database.insertMatch({reportId:'legacy-1',playedAt:'2026-08-21T10:00:00.000Z'},null,event.id),(error)=>error.code==='REPORT_ID_CONFLICT');
    assert.equal(
      migratedInformation.information.general.intro,
      'Información histórica que debe conservarse.'
    );
    assert.deepEqual(
      database.listRegistrationFields(event.id).map((field) => field.key),
      ['discord_username', 'game_name', 'friend_code', 'same_as_discord']
    );
    database.close();
  });


  it('keeps the optional banner separate from the cover and defaults it to null', () => {
    const database = openDatabase(temporaryPath());

    // El evento semilla trae banner apaisado propio: la portada es vertical y
    // en la franja ancha de la cabecera se recortaría casi entera.
    const seeded = database.getDefaultEvent();
    assert.equal(seeded.coverImage, '/images/events/among-us-cover.jpg');
    assert.equal(seeded.bannerImage, '/images/events/among-us-banner.jpg');

    // Un evento nuevo no está obligado a tener banner.
    const created = database.createEvent({
      slug: 'sin-banner', name: 'Sin banner', game: 'Valorant',
      description: 'Prueba', status: 'Próximamente',
      accentColor: '#ff4655', icon: 'crosshair',
      coverImage: '/images/events/portada.png'
    });
    assert.equal(created.bannerImage, null);

    const conBanner = database.updateEvent(created.id, {
      ...created, bannerImage: '/images/events/banner.jpg'
    });
    assert.equal(conBanner.bannerImage, '/images/events/banner.jpg');
    assert.equal(conBanner.coverImage, '/images/events/portada.png');

    assert.throws(
      () => database.updateEvent(created.id, { ...created, bannerImage: 'https://ajeno.example/x.jpg' }),
      /bannerImage/
    );

    database.close();
  });

  it('keeps Discord uniqueness scoped to each event', () => {
    const database = openDatabase(temporaryPath());
    const amongUs = database.getDefaultEvent();
    const minecraft = database.createEvent({
      name: 'Torneo Minecraft',
      slug: 'minecraft-verano-2026',
      game: 'Minecraft',
      description: 'Construcción para la comunidad.',
      minParticipants: 8,
      maxParticipants: 24,
      coverImage: '/images/events/default-event-cover.jpg',
      registrationsOpen: true,
      modules: { registration: true, participants: true }
    });

    database.createParticipant(amongUs.id, {
      discord_username: 'Luis',
      game_name: 'Pelusero',
      friend_code: 'luis#1001',
      same_as_discord: false
    });
    database.createParticipant(minecraft.id, {
      discord_username: 'Luis',
      game_name: 'LuisMC',
      same_as_discord: false
    });

    assert.equal(database.listParticipants(amongUs.id).length, 1);
    assert.equal(database.listParticipants(minecraft.id).length, 1);
    assert.equal(minecraft.minParticipants, 8);
    assert.equal(minecraft.coverImage, '/images/events/default-event-cover.jpg');
    assert.throws(
      () => database.createParticipant(amongUs.id, {
        discord_username: 'luis',
        game_name: 'Otro',
        friend_code: 'luis#9999',
        same_as_discord: false
      }),
      (error) => error.code === 'ALREADY_REGISTERED'
    );
    database.close();
  });

  it('keeps the default event identity when its configurable slug changes', () => {
    const dbPath = temporaryPath();
    let database = openDatabase(dbPath);
    const original = database.getDefaultEvent();
    database.insertMatch({ reportId: 'stable-default' }, null, original.id);
    database.updateEvent(original.id, {
      slug: 'among-us-renombrado',
      minParticipants: 12,
      coverImage: '/images/events/default-event-cover.jpg'
    });
    database.close();

    database = openDatabase(dbPath);
    const reopened = database.getDefaultEvent();
    assert.equal(reopened.id, original.id);
    assert.equal(reopened.slug, 'among-us-renombrado');
    assert.equal(reopened.minParticipants, 12);
    assert.equal(reopened.coverImage, '/images/events/default-event-cover.jpg');
    assert.equal(database.listEvents({ includeArchived: true }).length, 1);
    assert.equal(database.countMatches(reopened.id), 1);
    database.close();
  });
});
