'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { createFakeProvider } = require('../src/services/ocr/fake-provider');
const { renderScreenshot, postMatchLines, PARTIDA_DE_MUESTRA } = require('./helpers/fake-screenshot');

const ADMIN = 'token-de-pruebas';
const SALTO = String.fromCharCode(10);
const SEPARADOR = SALTO + SALTO;

describe('resultados por captura, de punta a punta', () => {
  const directorios = [];
  const bases = [];
  const servidores = [];

  afterEach(() => {
    servidores.splice(0).forEach((s) => { try { s.close(); } catch { /* ya cerrado */ } });
    bases.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
    directorios.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  /**
   * Un torneo con el draft hecho, la liga generada, los mapas puestos y los
   * Riot ID de la captura de muestra repartidos entre los dos equipos.
   */
  function torneoListo({ ocrTexto, teamCount = 4, slug = 'torneo-valorant', database: reutilizar = null, directorio: dirDado = null } = {}) {
    let directorio = dirDado;
    if (!directorio) {
      directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'jartiland-capturas-'));
      directorios.push(directorio);
    }
    const database = reutilizar || openDatabase(path.join(directorio, 'tournament.db'));
    if (!reutilizar) bases.push(database);

    const ocrProvider = createFakeProvider(ocrTexto ?? postMatchLines().join(SALTO));
    const app = createApp({
      database, adminToken: ADMIN, ocrProvider,
      captureStorageRoot: path.join(directorio, 'uploads')
    });

    const event = database.createEvent({
      slug, name: 'Torneo Valorant', game: 'Valorant',
      description: 'x', status: 'Inscripciones abiertas', registrationsOpen: true,
      modules: { draft: true },
      accentColor: '#ff4655', icon: 'crosshair', coverImage: '/images/events/x.png'
    });

    // Los diez primeros llevan los Riot ID que salen en la captura de muestra;
    // el resto rellenan hasta completar los equipos.
    const riotIds = PARTIDA_DE_MUESTRA.players.map((jugador) => jugador.name);
    const gente = [];
    for (let i = 0; i < teamCount * 5; i++) {
      const riotId = riotIds[i] ?? `Relleno${i}#JART`;
      const creado = database.createParticipant(event.id, {
        discord_username: `p${i}#d`,
        game_name: riotId.split('#')[0]
      });
      const confirmado = database.updateParticipant(creado.id, { status: 'confirmed' });
      // El Riot ID es la clave con la que el OCR reconoce a cada jugador: sin
      // él la asociación caería al nombre a secas.
      database.valorant.setRiotId(event.id, {
        participantId: confirmado.id, riotId, reason: 'alta de prueba'
      });
      gente.push(confirmado);
    }

    database.valorant.configureDraft(event.id, {
      captains: gente.slice(0, teamCount).map((p) => p.id), teamCount, teamSize: 5
    });
    database.valorant.startDraft(event.id);
    const elegibles = gente.slice(teamCount).map((p) => p.id);
    for (const participante of elegibles) {
      const draft = database.valorant.getDraft(event.id);
      const turno = database.valorant.teamForPick(event.id, draft.currentPick);
      database.valorant.pick(event.id, {
        captainParticipantId: turno.team.captainParticipantId,
        selectedParticipantId: participante
      });
    }

    database.valorantCompetition.generateRegularSeason(
      event.id, database.valorant.listTeams(event.id).map((e) => e.id));
    for (const serie of database.valorantCompetition.listSeries(event.id)) {
      database.valorantCompetition.assignMap(event.id, { seriesId: serie.id, mapKey: 'ascent' });
    }

    return { directorio, database, app, event, gente, ocrProvider };
  }

  /**
   * El texto que "lee" el OCR, construido a partir de los jugadores REALES de
   * ese partido. Escribirlo a mano no sirve: el draft reparte a la gente entre
   * todos los equipos, así que quién juega cada serie no se sabe hasta después.
   */
  function guionDelPartido(database, event, serie, { map = 'ASCENT', teamARounds = 13, teamBRounds = 8, extra = {} } = {}) {
    const col = (valor, ancho) => String(valor).padEnd(ancho);
    const equipos = database.valorant.listTeams(event.id);
    const equipoA = equipos.find((e) => e.id === serie.teamAId);
    const equipoB = equipos.find((e) => e.id === serie.teamBId);
    const jugadores = [...equipoA.members, ...equipoB.members];

    const filas = jugadores.map((miembro, indice) => ({
      name: miembro.riotId || miembro.displayName,
      agent: ['Raze', 'Jett', 'Omen', 'Sage', 'Sova'][indice % 5],
      acs: 290 - indice * 12,
      k: 24 - indice,
      d: 10 + indice,
      a: 3 + (indice % 6)
    }));

    const lineas = [
      'VALORANT COMPETITIVE',
      map,
      `${equipoA.name.toUpperCase()}  ${teamARounds}`,
      `${equipoB.name.toUpperCase()}  ${teamBRounds}`,
      '',
      `${col('PLAYER', 24)}${col('AGENT', 10)}${col('ACS', 6)}${col('K', 5)}${col('D', 5)}A`,
      ...filas.map((fila) =>
        `${col(fila.name, 24)}${col(fila.agent, 10)}${col(fila.acs, 6)}`
        + `${col(fila.k, 5)}${col(fila.d, 5)}${fila.a}`)
    ];
    return { lineas, texto: lineas.join(SALTO), filas, equipoA, equipoB, ...extra };
  }

  /** Monta el torneo y deja el OCR listo para leer el primer partido. */
  function torneoConGuion(opciones = {}) {
    const contexto = torneoListo(opciones);
    const serie = contexto.database.valorantCompetition.listSeries(contexto.event.id)[0];
    const guion = guionDelPartido(contexto.database, contexto.event, serie, opciones.guion);
    contexto.ocrProvider.setScript(guion.texto);
    return { ...contexto, serie, guion };
  }

  const admin = (app, metodo, ruta) => request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${ADMIN}`);

  /** Sube una captura al partido indicado. */
  async function subir(app, event, serie, imagen, { filename = 'captura.png', gameNumber = 1 } = {}) {
    return admin(app, 'post', `/api/admin/events/${event.id}/competition/captures`)
      .field('seriesId', String(serie.id))
      .field('gameNumber', String(gameNumber))
      .attach('captures', imagen, { filename, contentType: 'image/png' });
  }

  // ================================================ SEGURIDAD DE LA SUBIDA

  describe('seguridad de la subida', () => {
    it('sólo administración sube capturas', async () => {
      const { app, database, event } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      const imagen = await renderScreenshot(postMatchLines());

      const sinToken = await request(app)
        .post(`/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id))
        .attach('captures', imagen, { filename: 'x.png', contentType: 'image/png' });
      assert.equal(sinToken.status, 401);

      const malToken = await request(app)
        .post(`/api/admin/events/${event.id}/competition/captures`)
        .set('Authorization', 'Bearer no-es-el-token')
        .field('seriesId', String(serie.id))
        .attach('captures', imagen, { filename: 'x.png', contentType: 'image/png' });
      assert.equal(malToken.status, 401);
    });

    it('todas las rutas de capturas exigen el token', async () => {
      const { app, event } = torneoListo();
      const rutas = [
        ['get', `/api/admin/events/${event.id}/competition/captures`],
        ['get', `/api/admin/events/${event.id}/competition/captures/1`],
        ['post', `/api/admin/events/${event.id}/competition/captures/1/reprocess`],
        ['post', `/api/admin/events/${event.id}/competition/captures/1/preview`],
        ['post', `/api/admin/events/${event.id}/competition/captures/1/confirm`],
        ['delete', `/api/admin/events/${event.id}/competition/captures/1`],
        ['get', `/api/admin/events/${event.id}/competition/captures/1/image/1`]
      ];
      for (const [metodo, ruta] of rutas) {
        assert.equal((await request(app)[metodo](ruta).send({})).status, 401, `${metodo} ${ruta}`);
        assert.equal((await request(app)[metodo](ruta)
          .set('Authorization', 'Bearer falso').send({})).status, 401, `${metodo} ${ruta} falso`);
      }
    });

    it('acepta PNG, JPEG y WebP', async () => {
      const { app, database, event } = torneoListo();
      const series = database.valorantCompetition.listSeries(event.id);

      for (const [indice, formato] of [['png', 'image/png'], ['jpeg', 'image/jpeg'],
        ['webp', 'image/webp']].entries()) {
        const imagen = await renderScreenshot(postMatchLines(), { format: formato[0] });
        const respuesta = await admin(app, 'post',
          `/api/admin/events/${event.id}/competition/captures`)
          .field('seriesId', String(series[indice].id))
          .attach('captures', imagen, { filename: `x.${formato[0]}`, contentType: formato[1] });
        assert.equal(respuesta.status, 201, formato[0]);
      }
    });

    it('rechaza SVG, texto disfrazado y basura', async () => {
      const { app, database, event } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];

      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const porMime = await admin(app, 'post', `/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id))
        .attach('captures', svg, { filename: 'x.svg', contentType: 'image/svg+xml' });
      assert.equal(porMime.status, 415, 'el SVG se rechaza por su tipo');

      // Y aunque mienta diciendo que es un PNG, los bytes lo delatan.
      const mintiendo = await admin(app, 'post', `/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id))
        .attach('captures', svg, { filename: 'x.png', contentType: 'image/png' });
      assert.equal(mintiendo.status, 415);
      assert.equal(mintiendo.body.error.code, 'UNSUPPORTED_TYPE');

      const texto = Buffer.from('no soy una imagen '.repeat(100));
      const comoPng = await admin(app, 'post', `/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id))
        .attach('captures', texto, { filename: 'captura.png', contentType: 'image/png' });
      assert.equal(comoPng.status, 415);
    });

    it('no se suben más de cinco imágenes', async () => {
      const { app, database, event } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      const imagen = await renderScreenshot(postMatchLines());

      let peticion = admin(app, 'post', `/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id));
      for (let i = 0; i < 6; i++) {
        peticion = peticion.attach('captures', imagen, {
          filename: `x${i}.png`, contentType: 'image/png'
        });
      }
      const respuesta = await peticion;
      assert.equal(respuesta.status, 413);
      assert.equal(respuesta.body.error.code, 'TOO_MANY_FILES');
    });

    it('el nombre del archivo nunca toca la ruta de disco', async () => {
      const { app, database, event, directorio } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      const imagen = await renderScreenshot(postMatchLines());

      const respuesta = await subir(app, event, serie, imagen, {
        filename: '../../../../hola.png'
      });
      assert.equal(respuesta.status, 201);

      const captura = respuesta.body.batch.captures[0];
      // La clave la genera el servidor: hexadecimal y dentro de la carpeta.
      assert.match(captura.storageKey, /^\d+\/\d+\/[0-9a-f]{32}\.png$/);
      assert.equal(captura.storageKey.includes('..'), false);

      // Y nada se ha escrito fuera de la carpeta de subidas.
      assert.equal(fs.existsSync(path.join(directorio, 'hola.png')), false);
      assert.equal(fs.existsSync(path.resolve(directorio, '..', 'hola.png')), false);
      assert.ok(fs.existsSync(path.join(directorio, 'uploads', captura.storageKey)));

      // El nombre que llegue se guarda sólo como dato, y nunca como ruta: da
      // igual que venga entero o ya recortado por el cliente.
      assert.equal(captura.originalFilename.includes('/'), false);
      assert.equal(captura.originalFilename.includes('\\'), false);
    });

    it('la misma imagen dos veces en el mismo lote no se duplica', async () => {
      const { app, database, event } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      const imagen = await renderScreenshot(postMatchLines());

      const respuesta = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures`)
        .field('seriesId', String(serie.id))
        .attach('captures', imagen, { filename: 'una.png', contentType: 'image/png' })
        .attach('captures', imagen, { filename: 'otra.png', contentType: 'image/png' });

      assert.equal(respuesta.status, 201);
      assert.equal(respuesta.body.batch.captures.length, 1, 'el mismo SHA no entra dos veces');
    });

    it('no se sube a una serie de otro evento', async () => {
      // Los dos eventos en la MISMA base: con bases distintas los identificadores
      // coinciden por casualidad y la prueba no demostraría nada.
      const uno = torneoListo({ slug: 'torneo-uno' });
      const otro = torneoListo({
        slug: 'torneo-dos', database: uno.database, directorio: uno.directorio
      });
      const serieAjena = otro.database.valorantCompetition.listSeries(otro.event.id)[0];
      const imagen = await renderScreenshot(postMatchLines());

      assert.notEqual(uno.event.id, otro.event.id);

      const respuesta = await admin(uno.app, 'post',
        `/api/admin/events/${uno.event.id}/competition/captures`)
        .field('seriesId', String(serieAjena.id))
        .attach('captures', imagen, { filename: 'x.png', contentType: 'image/png' });
      assert.equal(respuesta.status, 404);
      assert.equal(respuesta.body.error.code, 'SERIES_NOT_FOUND');
    });

    it('la carpeta de subidas no se sirve como estática', async () => {
      const { app, database, event } = torneoListo();
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      const subida = await subir(app, event, serie, await renderScreenshot(postMatchLines()));
      const captura = subida.body.batch.captures[0];

      for (const ruta of [`/${captura.storageKey}`, `/uploads/${captura.storageKey}`,
        `/data/uploads/valorant/${captura.storageKey}`]) {
        const respuesta = await request(app).get(ruta);
        assert.notEqual(respuesta.status, 200, `${ruta} no debe servirse`);
      }

      // Sólo por la ruta autenticada.
      const anonima = await request(app).get(
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/image/${captura.id}`);
      assert.equal(anonima.status, 401);

      const conToken = await admin(app, 'get',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/image/${captura.id}`);
      assert.equal(conToken.status, 200);
      assert.equal(conToken.headers['content-type'], 'image/png');
      assert.match(conToken.headers['cache-control'], /no-store/);
    });
  });

  // ============================================================ E2E COMPLETO

  describe('el recorrido entero', () => {
    it('subir, previsualizar, confirmar y verlo en público', async () => {
      const { app, database, event, serie, guion } = torneoConGuion();
      const equipos = database.valorant.listTeams(event.id);

      // --- el canal en directo, escuchando desde antes ---
      const avisos = [];
      let buffer = '';
      const servidor = app.listen(0);
      servidores.push(servidor);
      await new Promise((resolve) => {
        const peticion = http.get(
          { port: servidor.address().port, path: `/api/events/${event.slug}/draft/stream` },
          (respuesta) => {
            respuesta.setEncoding('utf8');
            respuesta.on('data', (trozo) => {
              buffer += trozo;
              const partes = buffer.split(SEPARADOR);
              buffer = partes.pop();
              for (const bruto of partes) {
                const frame = { raw: bruto, event: null, data: null };
                for (const linea of bruto.split(SALTO)) {
                  if (linea.startsWith('event: ')) frame.event = linea.slice(7).trim();
                  if (linea.startsWith('data: ')) frame.data = linea.slice(6).trim();
                }
                if (frame.event) avisos.push(frame);
              }
            });
            resolve();
          });
        peticion.on('error', resolve);
        servidores.push({ close: () => peticion.destroy() });
      });

      const tablaAntes = database.valorantCompetition.standings(event.id, { teams: equipos });
      assert.equal(tablaAntes.seriesPlayed, 0);

      // --- 1. subir ---
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      assert.equal(subida.status, 201, JSON.stringify(subida.body));

      const lote = subida.body.batch;
      const preview = subida.body.preview;

      assert.equal(lote.status, 'READY', `esperaba READY, hubo ${lote.status}: ${JSON.stringify(preview.issues)}`);
      assert.equal(preview.map, 'ascent');
      assert.equal(preview.teamARounds, 13);
      assert.equal(preview.teamBRounds, 8);
      assert.equal(preview.players.length, 10);
      assert.equal(preview.players.every((jugador) => jugador.participantId), true,
        'los diez quedan asociados por su Riot ID');
      assert.equal(preview.players.every((jugador) => jugador.match === 'RIOT_ID'), true);

      // --- 2. antes de confirmar, nada ha cambiado ---
      const enMedio = database.valorantCompetition.standings(event.id, { teams: equipos });
      assert.equal(enMedio.seriesPlayed, 0, 'la previsualización no toca la clasificación');
      assert.equal(database.valorantCompetition.getSeries(event.id, serie.id).games[0].status,
        'WAITING_RESULT');

      const publicoAntes = await request(app).get(`/api/events/${event.slug}/competition-teams`);
      assert.equal(publicoAntes.body.seriesPlayed, 0);

      // --- 3. confirmar ---
      const confirmada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${lote.id}/confirm`)
        .send({
          mapKey: preview.map,
          teamARounds: preview.teamARounds,
          teamBRounds: preview.teamBRounds,
          players: preview.players.map((jugador) => ({
            participantId: jugador.participantId,
            agent: jugador.agent,
            acs: jugador.acs, kills: jugador.kills, deaths: jugador.deaths, assists: jugador.assists
          }))
        });
      assert.equal(confirmada.status, 200, JSON.stringify(confirmada.body));

      // --- 4. el resultado es oficial y lo decidió el servidor ---
      const guardada = database.valorantCompetition.getSeries(event.id, serie.id);
      assert.equal(guardada.games[0].status, 'COMPLETED');
      assert.equal(guardada.games[0].resultSource, 'SCREENSHOT');
      assert.equal(guardada.games[0].teamARounds, 13);
      assert.equal(guardada.winnerTeamId, serie.teamAId, 'gana quien tiene 13, lo calcula el servidor');

      const estadisticas = database.valorantCompetition.listGameStats(guardada.games[0].id);
      assert.equal(estadisticas.length, 10);
      const primero = estadisticas.find((fila) => fila.kills === 24);
      assert.equal(primero.acs, 290);
      assert.equal(primero.agent, 'Raze');
      assert.equal(primero.adr, null, 'esa captura no traía ADR: null, no cero');

      assert.equal(database.valorantCaptures.getBatch(event.id, lote.id).status, 'CONFIRMED');

      // --- 5. queda en la auditoría con su lote ---
      const auditoria = await admin(app, 'get', `/api/admin/events/${event.id}/audit`);
      const registro = auditoria.body.audit.find((fila) => fila.action === 'RESULT_RECORDED');
      const detalle = typeof registro.details === 'string'
        ? JSON.parse(registro.details) : registro.details;
      assert.equal(detalle.source, 'SCREENSHOT');
      assert.equal(detalle.captureBatchId, lote.id);

      // --- 6. el canal avisa DESPUÉS de guardar ---
      for (let i = 0; i < 60 && !avisos.some((a) => a.event === 'competition_updated'); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const aviso = avisos.find((a) => a.event === 'competition_updated');
      assert.ok(aviso, `no llegó el aviso. Hubo: ${avisos.map((a) => a.event).join(', ')}`);
      // El aviso no lleva las estadísticas: sólo dice que hay que volver a pedirlas.
      assert.deepEqual(Object.keys(JSON.parse(aviso.data)).sort(), ['revision', 'type']);

      // --- 7. y el público lo ve, sin recargar nada ---
      const publico = await request(app).get(`/api/events/${event.slug}/competition-teams`).expect(200);
      assert.equal(publico.body.seriesPlayed, 1);

      const partidoPublico = publico.body.matchdays
        .flatMap((jornada) => jornada.series)
        .find((s) => s.id === serie.id);
      assert.equal(partidoPublico.status, 'COMPLETED');
      assert.equal(partidoPublico.games[0].mapKey, 'ascent');
      assert.equal(partidoPublico.games[0].teamARounds, 13);
      assert.equal(partidoPublico.games[0].stats.length, 10);
      assert.equal(partidoPublico.games[0].stats[0].acs > 0, true);

      // Estadísticas agregadas del torneo.
      assert.equal(publico.body.playerStats.length, 10);
      const agregado = publico.body.playerStats.find((fila) => fila.kills === 24);
      assert.equal(agregado.games, 1);
      assert.equal(agregado.acs, 290);
      assert.equal(agregado.adr, null, 'sin ADR en ninguna captura, no hay media de ADR');
      assert.equal(agregado.sampleSizes.adr, 0);
      assert.equal(agregado.sampleSizes.acs, 1);

      // --- 8. y nada privado se ha escapado ---
      const texto = JSON.stringify(publico.body).toLowerCase();
      /*
        La palabra «discord» aparece ahora en el formato publicado —el draft se
        hace por Discord— y eso es texto para leer. Lo que no puede salir es la
        identidad: usuario, id de cuenta y la URL del CDN, que lleva el id.
      */
      for (const prohibido of ['storagekey', 'ocr', 'confidence', 'reason',
        'discord_username', 'discordUserId', 'discord_account_id', 'cdn.discordapp.com',
        'audit', 'sha256', 'uploads', '.png']) {
        assert.equal(texto.includes(prohibido), false, `no debe salir ${prohibido}`);
      }
    });

    it('confirmar dos veces no duplica estadísticas', async () => {
      const { app, database, event, serie, guion } = torneoConGuion();
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      const lote = subida.body.batch;
      const preview = subida.body.preview;

      const cuerpo = {
        mapKey: preview.map,
        teamARounds: preview.teamARounds,
        teamBRounds: preview.teamBRounds,
        players: preview.players.map((jugador) => ({
          participantId: jugador.participantId, agent: jugador.agent,
          acs: jugador.acs, kills: jugador.kills, deaths: jugador.deaths, assists: jugador.assists
        }))
      };

      await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${lote.id}/confirm`)
        .send(cuerpo).expect(200);

      const segunda = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${lote.id}/confirm`)
        .send(cuerpo);
      assert.equal(segunda.status, 200);
      assert.equal(segunda.body.alreadyConfirmed, true, 'la segunda no hace trabajo');

      const juego = database.valorantCompetition.getSeries(event.id, serie.id).games[0];
      assert.equal(database.valorantCompetition.listGameStats(juego.id).length, 10,
        'siguen siendo diez, no veinte');
    });

    it('un segundo lote no puede pisar un resultado ya cerrado', async () => {
      const { app, database, event, serie, guion } = torneoConGuion();

      const primera = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${primera.body.batch.id}/confirm`)
        .send({
          mapKey: 'ascent', teamARounds: 13, teamBRounds: 8,
          players: primera.body.preview.players.map((j) => ({ participantId: j.participantId }))
        }).expect(200);

      // Otra captura del mismo partido, subida después.
      const segunda = await subir(app, event, serie,
        await renderScreenshot([...guion.lineas, 'SEGUNDA']));
      const rechazada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${segunda.body.batch.id}/confirm`)
        .send({ mapKey: 'ascent', teamARounds: 13, teamBRounds: 8, players: [] });

      assert.equal(rechazada.status, 409);
      assert.equal(rechazada.body.error.code, 'RESULT_ALREADY_RECORDED');
    });
  });

  // ========================================================== COMPROBACIONES

  describe('lo que no se importa sin mirarlo', () => {
    it('un mapa distinto del asignado no entra en silencio', async () => {
      // La captura dice Haven; el partido tiene Ascent asignado.
      const { app, event, serie, guion } = torneoConGuion({ guion: { map: 'HAVEN' } });
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      assert.equal(subida.body.batch.status, 'REVIEW_REQUIRED');
      const problema = subida.body.preview.issues.find((i) => i.code === 'MAP_MISMATCH');
      assert.ok(problema, 'tiene que avisar del mapa');
      assert.equal(problema.detected, 'haven');
      assert.equal(problema.expected, 'ascent');

      const rechazada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({ mapKey: 'haven', teamARounds: 13, teamBRounds: 8, players: [] });
      assert.equal(rechazada.status, 409);
      assert.equal(rechazada.body.error.code, 'MAP_MISMATCH');

      // Saltárselo es excepcional y pide motivo.
      const sinMotivo = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({ mapKey: 'haven', teamARounds: 13, teamBRounds: 8, players: [], overrideMap: true });
      assert.equal(sinMotivo.status, 400);
      assert.equal(sinMotivo.body.error.code, 'REASON_REQUIRED');
    });

    it('un jugador que no juega ese partido no se importa', async () => {
      const uno = torneoConGuion();
      const serie = uno.serie;
      const subida = await subir(uno.app, uno.event, serie, await renderScreenshot(uno.guion.lineas));

      // Alguien del torneo, pero de otro equipo.
      const ajeno = uno.database.valorant.listTeams(uno.event.id)
        .find((equipo) => equipo.id !== serie.teamAId && equipo.id !== serie.teamBId)
        .members[0].participantId;

      const rechazada = await admin(uno.app, 'post',
        `/api/admin/events/${uno.event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({
          mapKey: 'ascent', teamARounds: 13, teamBRounds: 8,
          players: [{ participantId: ajeno, kills: 20 }]
        });
      assert.equal(rechazada.status, 400);
      assert.equal(rechazada.body.error.code, 'PLAYER_NOT_IN_SERIES');
    });

    it('el mismo jugador dos veces en la misma partida se rechaza', async () => {
      const { app, event, serie, guion } = torneoConGuion();
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      const alguien = subida.body.preview.players[0].participantId;

      const rechazada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({
          mapKey: 'ascent', teamARounds: 13, teamBRounds: 8,
          players: [{ participantId: alguien, kills: 20 }, { participantId: alguien, kills: 5 }]
        });
      assert.equal(rechazada.status, 400);
      assert.equal(rechazada.body.error.code, 'DUPLICATE_PLAYER');
    });

    it('un marcador imposible no entra aunque lo diga la captura', async () => {
      const { app, event, serie, guion } = torneoConGuion();
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));

      const rechazada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({ mapKey: 'ascent', teamARounds: 3, teamBRounds: 1, players: [] });
      assert.equal(rechazada.status, 400);
      assert.equal(rechazada.body.error.code, 'SCORE_INCOMPLETE');
    });

    it('un porcentaje imposible se rechaza', async () => {
      const { app, event, serie, guion } = torneoConGuion();
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      const alguien = subida.body.preview.players[0].participantId;

      const rechazada = await admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({
          mapKey: 'ascent', teamARounds: 13, teamBRounds: 8,
          players: [{ participantId: alguien, hsPercent: 150 }]
        });
      assert.equal(rechazada.status, 400);
      assert.equal(rechazada.body.error.code, 'INVALID_PERCENT');
    });

    it('una captura ilegible pide revisión en vez de inventar', async () => {
      const { app, database, event } = torneoListo({ ocrTexto: 'ruido sin sentido alguno' });
      const serie = database.valorantCompetition.listSeries(event.id)[0];
      // Con suficientes líneas para que la imagen supere el mínimo de tamaño:
      // lo que se prueba aquí es el texto ilegible, no una imagen pequeña.
      const subida = await subir(app, event, serie,
        await renderScreenshot(Array.from({ length: 8 }, () => 'ruido sin sentido alguno')));

      assert.equal(subida.status, 201, JSON.stringify(subida.body));
      assert.equal(subida.body.batch.status, 'REVIEW_REQUIRED');
      const codigos = subida.body.preview.issues.map((i) => i.code);
      assert.ok(codigos.includes('UNKNOWN_CAPTURE'), `códigos: ${codigos}`);
      assert.equal(subida.body.preview.teamARounds, null, 'no se inventa marcador');
      assert.equal(subida.body.preview.map, null);
    });

    it('descartar un lote se lleva sus archivos', async () => {
      const { app, database, event, directorio, serie, guion } = torneoConGuion();
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      const lote = subida.body.batch;
      const ruta = path.join(directorio, 'uploads', lote.captures[0].storageKey);
      assert.ok(fs.existsSync(ruta));

      await admin(app, 'delete',
        `/api/admin/events/${event.id}/competition/captures/${lote.id}`).expect(200);

      assert.equal(fs.existsSync(ruta), false, 'la imagen se borra con el lote');
      assert.equal(database.valorantCaptures.getBatch(event.id, lote.id), null);
    });
  });

  // ========================================================= PÚBLICO Y MEDIAS

  describe('lo que se publica', () => {
    /** Confirma un partido con las estadísticas que se le pasen. */
    async function confirmar(app, event, serie, guion, extra = {}) {
      const subida = await subir(app, event, serie, await renderScreenshot(guion.lineas));
      assert.equal(subida.status, 201, JSON.stringify(subida.body));
      const preview = subida.body.preview;

      return admin(app, 'post',
        `/api/admin/events/${event.id}/competition/captures/${subida.body.batch.id}/confirm`)
        .send({
          mapKey: preview.map,
          teamARounds: preview.teamARounds,
          teamBRounds: preview.teamBRounds,
          players: preview.players.map((jugador, indice) => {
            const base = {
              participantId: jugador.participantId,
              agent: jugador.agent,
              acs: jugador.acs, kills: jugador.kills,
              deaths: jugador.deaths, assists: jugador.assists,
              ...(extra.adrDesde !== undefined && indice < (extra.conAdr ?? 99)
                ? { adr: extra.adrDesde + indice * 10 } : {})
            };
            return { ...base, ...(extra.transformPlayer?.(base, indice) || {}) };
          })
        });
    }

    it('las medias sólo cuentan las partidas donde el dato aparece', async () => {
      const { app, database, event, serie, guion, ocrProvider } = torneoConGuion();

      // Primer partido CON ADR.
      await confirmar(app, event, serie, guion, { adrDesde: 150, conAdr: 99 }).then((r) =>
        assert.equal(r.status, 200, JSON.stringify(r.body)));

      // Segundo partido del mismo equipo, SIN ADR en la captura.
      const otra = database.valorantCompetition.listSeries(event.id)
        .find((s) => s.id !== serie.id
          && (s.teamAId === serie.teamAId || s.teamBId === serie.teamAId));
      const guionOtra = guionDelPartido(database, event, otra);
      ocrProvider.setScript(guionOtra.texto);
      await confirmar(app, event, otra, guionOtra).then((r) =>
        assert.equal(r.status, 200, JSON.stringify(r.body)));

      const publico = await request(app)
        .get(`/api/events/${event.slug}/competition-teams`).expect(200);

      // Quien jugó los dos partidos tiene dos partidas, pero un solo ADR.
      const conDos = publico.body.playerStats.filter((fila) => fila.games === 2);
      assert.ok(conDos.length > 0, 'alguien debería haber jugado los dos partidos');

      for (const fila of conDos) {
        assert.equal(fila.sampleSizes.acs, 2, 'el ACS estaba en las dos');
        assert.equal(fila.sampleSizes.adr, 1, 'el ADR sólo en una');
        assert.ok(fila.adr >= 150,
          `la media de ADR (${fila.adr}) no puede hundirse por la partida sin dato`);
      }
    });

    it('calcula K/D sólo con mapas que tengan kills y deaths emparejadas', async () => {
      const { app, database, event, serie, guion, ocrProvider } = torneoConGuion();
      const participantId = guion.equipoA.members[0].participantId;

      await confirmar(app, event, serie, guion, {
        transformPlayer: (player) => player.participantId === participantId ? { deaths: null } : null
      }).then((response) => assert.equal(response.status, 200, JSON.stringify(response.body)));

      const otra = database.valorantCompetition.listSeries(event.id)
        .find((item) => item.id !== serie.id
          && (item.teamAId === guion.equipoA.id || item.teamBId === guion.equipoA.id));
      const guionOtra = guionDelPartido(database, event, otra);
      ocrProvider.setScript(guionOtra.texto);
      await confirmar(app, event, otra, guionOtra, {
        transformPlayer: (player) => player.participantId === participantId ? { kills: null } : null
      }).then((response) => assert.equal(response.status, 200, JSON.stringify(response.body)));

      const player = database.valorantCompetition.tournamentPlayerStats(event.id)
        .find((row) => row.participantId === participantId);
      assert.equal(player.kd, null);
      assert.equal(player.sampleSizes.kd, 0);
      assert.equal(player.sampleSizes.kills, 1);
      assert.equal(player.sampleSizes.deaths, 1);
    });

    it('la tabla del partido llega completa y sin nada privado', async () => {
      const { app, event, serie, guion } = torneoConGuion();
      await confirmar(app, event, serie, guion).then((r) => assert.equal(r.status, 200));

      const publico = await request(app)
        .get(`/api/events/${event.slug}/competition-teams`).expect(200);

      const partido = publico.body.matchdays.flatMap((j) => j.series)
        .find((s) => s.id === serie.id);
      assert.equal(partido.games[0].stats.length, 10);

      // Cada fila trae lo necesario para pintarla y nada más.
      const fila = partido.games[0].stats[0];
      assert.deepEqual(Object.keys(fila).sort(), [
        'acs', 'adr', 'agent', 'assists', 'deaths', 'firstDeaths', 'firstKills',
        'hsPercent', 'kastPercent', 'kills', 'participantId', 'plusMinus', 'teamId'
      ]);

      // Los nombres para pintar la tabla salen de aquí, sin datos personales.
      assert.ok(publico.body.teams.length >= 2);
      const miembro = publico.body.teams[0].members[0];
      assert.deepEqual(Object.keys(miembro).sort(), ['displayName', 'participantId']);

      const texto = JSON.stringify(publico.body).toLowerCase();
      /*
        La palabra «discord» aparece ahora en el formato publicado —el draft se
        hace por Discord— y eso es texto para leer. Lo que no puede salir es la
        identidad: usuario, id de cuenta y la URL del CDN, que lleva el id.
      */
      for (const prohibido of ['discord_username', 'discordUserId', 'discord_account_id',
        'cdn.discordapp.com', 'riot', 'session', 'storagekey', 'sha256',
        'ocr', 'confidence', 'reason', 'audit', 'batch']) {
        assert.equal(texto.includes(prohibido), false, `no debe salir ${prohibido}`);
      }
    });

    it('sin partidas confirmadas no hay estadísticas que enseñar', async () => {
      const { app, event } = torneoConGuion();
      const publico = await request(app)
        .get(`/api/events/${event.slug}/competition-teams`).expect(200);
      assert.deepEqual(publico.body.playerStats, []);
    });
  });
});
