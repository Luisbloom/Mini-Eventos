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

  it('calcula un ranking global comparable sin alterar las estadísticas originales', () => {
    const rows = [
      { participantId: 1, games: 4, acs: 260, kd: 1.5, adr: 170, kastPercent: 78, hsPercent: 31, kills: 80, deaths: 54, assists: 28, firstKills: 12, firstDeaths: 5 },
      { participantId: 2, games: 4, acs: 205, kd: 1.05, adr: 135, kastPercent: 69, hsPercent: 24, kills: 60, deaths: 58, assists: 22, firstKills: 7, firstDeaths: 8 },
      { participantId: 3, games: 1, acs: 280, kd: 1.7, adr: 180, kastPercent: 81, hsPercent: 35, kills: 22, deaths: 13, assists: 8, firstKills: 4, firstDeaths: 1 }
    ];
    const ranked = View.rankPlayers(View.scoreGlobalPlayers(rows), 'globalScore');
    assert.deepEqual(ranked.map((row) => row.participantId), [1, 3, 2]);
    assert.ok(ranked.every((row) => row.globalScore >= 0 && row.globalScore <= 100));
    assert.equal(rows[0].globalScore, undefined);

    const incomplete = View.scoreGlobalPlayers([
      { participantId: 10, games: 3, acs: 220, kd: 1.1, deaths: 45, sampleSizes: { acs: 3, kd: 3, deaths: 3 } },
      { participantId: 11, games: 3, acs: 220, kd: 1.1, deaths: null, sampleSizes: { acs: 3, kd: 3, deaths: 0 } }
    ]);
    assert.ok(incomplete[0].globalScore > incomplete[1].globalScore, 'omitir deaths no puede mejorar el índice');

    const partial = View.scoreGlobalPlayers([
      { participantId: 20, games: 4, acs: 220, sampleSizes: { acs: 4 } },
      { participantId: 21, games: 4, acs: 220, sampleSizes: { acs: 1 } }
    ]);
    assert.ok(partial[0].globalScore > partial[1].globalScore, 'una sola muestra no pesa como cuatro');
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
