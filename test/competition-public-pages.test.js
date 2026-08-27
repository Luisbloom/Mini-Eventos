'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database');
const View = require('../public/competition-view');

describe('páginas públicas de la competición', () => {
  const directories = [];
  const databases = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  function app() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-public-pages-'));
    directories.push(directory);
    const database = openDatabase(path.join(directory, 'test.db'));
    databases.push(database);
    return createApp({ database, adminToken: 'test-admin' });
  }

  it('sirve una página enfocada en cada ruta pública', async () => {
    const application = app();
    const routes = [
      '/eventos/demo/competicion',
      '/eventos/demo/competicion/fase-regular',
      '/eventos/demo/competicion/fase-regular/clasificacion',
      '/eventos/demo/competicion/fase-regular/jornadas',
      '/eventos/demo/competicion/fase-regular/jornadas/3',
      '/eventos/demo/competicion/playoffs',
      '/eventos/demo/competicion/estadisticas',
      '/eventos/demo/competicion/resultados',
      '/eventos/demo/competicion/partidos/42'
    ];

    for (const route of routes) {
      const response = await request(application).get(route).expect(200);
      assert.match(response.text, /competition-pages\.js/);
      assert.match(response.text, /competition-content/);
    }

    const draft = await request(application)
      .get('/eventos/demo/competicion/draft')
      .expect(200);
    assert.match(draft.text, /draft\.js/);

    const legacyDraft = await request(application).get('/eventos/demo/draft').expect(200);
    assert.match(legacyDraft.text, /draft\.js/);
  });

  it('interpreta las rutas sin confundir slug, jornada y serie', () => {
    assert.deepEqual(View.routeFor('/eventos/copa-roja/competicion'), {
      name: 'hub', slug: 'copa-roja', parameter: null
    });
    assert.deepEqual(View.routeFor('/eventos/copa-roja/competicion/fase-regular/jornadas/4'), {
      name: 'matchday', slug: 'copa-roja', parameter: 4
    });
    assert.deepEqual(View.routeFor('/eventos/copa-roja/competicion/partidos/91'), {
      name: 'match', slug: 'copa-roja', parameter: 91
    });
  });

  it('expone las tres fases y el ranking en la navegación principal', () => {
    assert.deepEqual(View.navItems('copa-roja').map((item) => item.label), [
      'Resumen', 'Draft', 'Fase regular', 'Playoffs', 'Ranking'
    ]);
  });

  it('mantiene el mismo menu reducido tambien dentro del Draft', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'draft.html'), 'utf8');
    assert.match(html, /id="draft-nav-stats"/);
    assert.doesNotMatch(html, /id="draft-nav-results"/);
  });

  it('crea un estado público vacío para un torneo anunciado sin filtrar datos', () => {
    const preview = View.previewCompetitionState();
    assert.equal(preview.preview, true);
    assert.equal(preview.generated, false);
    assert.equal(preview.complete, false);
    assert.deepEqual(preview.teams, []);
    assert.deepEqual(preview.standings, []);
    assert.deepEqual(preview.matchdays, []);
    assert.deepEqual(preview.playerStats, []);
    assert.deepEqual(preview.playoffs.series, []);
  });

  it('aplana liga y playoffs y localiza una serie sin duplicarla', () => {
    const state = {
      matchdays: [
        { matchday: 1, series: [{ id: 10, status: 'COMPLETED' }] },
        { matchday: 2, series: [{ id: 11, status: 'READY' }] }
      ],
      playoffs: { series: [{ id: 20, status: 'READY' }] }
    };

    assert.deepEqual(View.flattenRegularSeries(state).map((series) => series.id), [10, 11]);
    assert.deepEqual(View.allSeries(state).map((series) => series.id), [10, 11, 20]);
    assert.equal(View.findSeries(state, 20).id, 20);
    assert.equal(View.findSeries(state, 999), null);
    assert.equal(View.nextSeries({
      ...state,
      matchdays: [{ matchday: 1, series: [
        { id: 11, status: 'READY', teamA: { teamId: 1 }, teamB: { teamId: 2 } }
      ] }]
    }).id, 11);
    assert.equal(View.nextSeries({
      playoffs: { series: [{ id: 21, status: 'PENDING', teamA: null, teamB: null }] }
    }), null);
  });

  it('ordena estadísticas sin mutar los datos recibidos', () => {
    const rows = [
      { participantId: 1, acs: 210, kills: 40 },
      { participantId: 2, acs: 250, kills: 35 },
      { participantId: 3, acs: null, kills: 50, deaths: null }
    ];
    const ranked = View.rankPlayers(rows, 'acs');
    assert.deepEqual(ranked.map((row) => row.participantId), [2, 1, 3]);
    assert.deepEqual(rows.map((row) => row.participantId), [1, 2, 3]);
    assert.equal(View.rankPlayers([
      { participantId: 1, deaths: null },
      { participantId: 2, deaths: 12 },
      { participantId: 3, deaths: 8 }
    ], 'deaths', 'asc').map((row) => row.participantId).join(','), '3,2,1');
  });

  it('no publica puestos de playoffs hasta que esten decididos', () => {
    const placements = View.confirmedPlacements([
      { teamId: 1, position: null },
      { teamId: 2, position: undefined },
      { teamId: 3, position: 3 }
    ]);
    assert.deepEqual(placements, [{ teamId: 3, position: 3 }]);
  });
});
