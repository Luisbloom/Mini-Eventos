'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const { buildLeaderboard } = require('./leaderboard');
const { getPublicScoringRules, SCORING_CONFIG } = require('./services/scoring');
const { InformationValidationError } = require('./tournament-information');
const { EventValidationError, VALORANT_PEAK_RANKS } = require('./events');
const { CompetitionError } = require('./competition');
const { createMatchIngestor } = require('./services/match-ingest');
const {
  createDiscordProvider, DiscordOAuthError,
  sessionCookie, clearedSessionCookie, readSessionCookie, safeReturnPath,
  oauthNonceCookie, clearedOAuthNonceCookie, readOAuthNonceCookie
} = require('./services/discord-oauth');
const { ValorantError } = require('./valorant-store');
const { createDraftStream } = require('./services/draft-stream');
const { CompetitionError: ValorantCompetitionError } = require('./valorant-competition');
const { CaptureError } = require('./valorant-captures');
const { PlayoffError } = require('./valorant-playoffs');
const { officialValorantFormatForSlug } = require('./valorant-event-format');
const { gameProfile, isAmongUs, isValorant } = require('./games');
const { buildMetadata, injectMetadata } = require('./services/social-metadata');
const {
  createCaptureStorage, inspectImage, UploadError, LIMITS: UPLOAD_LIMITS, ALLOWED_MIME
} = require('./services/captures/storage');
const { readCapture, buildPreview } = require('./services/captures/ingest');
const { createTesseractProvider } = require('./services/ocr');
const { createReporterContextResolver } = require('./services/reporter-context');
const { mapScheduleForStage } = require('./amongus-maps');
const {
  ReporterAuthError,
  createReporterAuthorizer,
  generateReporterToken,
  hashReporterToken,
  readBearer
} = require('./services/reporter-auth');

const PUBLIC_DIRECTORY = path.resolve(__dirname, '..', 'public');

/** El slug de un evento llega de la base: se escapa antes de meterlo en XML. */
const escapeXml = (valor) => String(valor)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const MAX_MATCHES_PER_PAGE = 100;

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } });
}

function isReport(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0;
}

function hasStageContext(report) {
  return report.stageId !== undefined && report.stageId !== null && report.stageId !== '';
}

function hasCompetitiveContext(report) {
  return ['stageId', 'groupId', 'matchNumber'].some((field) => (
    report[field] !== undefined && report[field] !== null && report[field] !== ''
  ));
}

function parseLimit(rawLimit) {
  if (rawLimit === undefined) return 50;
  if (!/^\d+$/.test(String(rawLimit))) return null;
  const value = Number(rawLimit);
  return value < 1 ? null : Math.min(value, MAX_MATCHES_PER_PAGE);
}

function parseId(rawId) {
  return /^\d+$/.test(String(rawId)) && Number(rawId) > 0 ? Number(rawId) : null;
}

function tokensMatch(supplied, expected) {
  const suppliedBuffer = Buffer.from(supplied || '');
  const expectedBuffer = Buffer.from(expected || '');
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function scoringPayload() {
  return { config: SCORING_CONFIG, rules: getPublicScoringRules() };
}

function publicParticipant(participant) {
  return {
    id: participant.id,
    eventId: participant.eventId,
    displayName: participant.displayName,
    status: participant.status,
    createdAt: participant.createdAt
  };
}

function publicMatch(match) {
  const report = match.report || {};
  return {
    id: match.id,
    eventId: match.eventId,
    receivedAt: match.receivedAt,
    duplicate: match.duplicate === true,
    stageId: match.stageId,
    groupId: match.groupId,
    matchNumber: match.matchNumber,
    playedAt: match.playedAt,
    status: match.matchStatus,
    voidReason: match.matchStatus === 'VOID' ? match.voidReason : null,
    result: {
      reportId: report.reportId ?? null,
      map: report.map ?? null,
      gameMode: report.gameMode ?? null,
      winner: report.winner ?? null,
      durationSeconds: report.durationSeconds ?? null,
      playerCount: Array.isArray(report.players) ? report.players.length : null,
      demo: report.demo === true
    }
  };
}

function eventScoring(event) {
  return isAmongUs(event.game) ? scoringPayload() : null;
}

function createApp({
  database,
  trustProxy = false,
  logger = console,
  adminToken = null,
  reporterToken = null,
  reporterPrivateUrl = null,
  discord = null,
  discordAvatarFetch = globalThis.fetch,
  secureCookies = false,
  // El OCR se puede sustituir por uno falso en las pruebas: lo que hay que
  // probar es el parser y la confirmación, no que Tesseract acierte.
  ocrProvider = null,
  captureStorageRoot = null,
  // Origen público con el que se construyen los enlaces de las tarjetas
  // sociales. Si no se configura se deduce de la petición.
  publicBaseUrl = null
}) {
  if (!database) throw new TypeError('createApp necesita una base de datos');

  const app = express();
  const matchIngestor = createMatchIngestor({ database });
  const reporterAuthorizer = createReporterAuthorizer({
    legacyToken: reporterToken,
    competition: database.competition
  });
  const reporterContextResolver = createReporterContextResolver({ database });
  // Sin credenciales el proveedor queda desactivado, pero el servidor arranca.
  const discordProvider = discord || createDiscordProvider();
  const draftStream = createDraftStream();
  const captureStorage = createCaptureStorage({
    root: captureStorageRoot || path.resolve(__dirname, '..', 'data', 'uploads', 'valorant')
  });
  // Se crea sin arrancar: el worker de Tesseract sólo se levanta con la primera
  // captura, así el servidor no paga ese arranque si nadie sube nada.
  const ocr = ocrProvider || createTesseractProvider();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  // El HTML y el JSON del torneo son texto y comprimen muchísimo. Las imágenes
  // ya vienen comprimidas y compression las deja en paz por su cuenta.
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => logger.info({
      event: 'http_request', method: request.method, path: request.originalUrl,
      status: response.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      remoteAddress: request.ip
    }));
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));

  function eventFromSlug(request, response) {
    const event = database.getEventBySlug(request.params.slug);
    if (!event || event.archived) {
      sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      return null;
    }
    return event;
  }

  function authorizeReporter(request, event, report) {
    const suppliedToken = readBearer(request);
    const competitive = hasCompetitiveContext(report);
    if (!competitive && !reporterToken && !suppliedToken) {
      return { host: null, authenticationKind: 'LEGACY_UNAUTHENTICATED' };
    }
    return reporterAuthorizer.authorize({
      eventId: event.id,
      hostId: report.hostId,
      suppliedToken,
      requireHost: hasStageContext(report)
    });
  }

  function ingestReporterMatch({ event, report, request }) {
    const authentication = authorizeReporter(request, event, report);
    const submittedBy = authentication.host?.identifier || 'LEGACY_REPORTER';
    const match = hasCompetitiveContext(report)
      ? matchIngestor.ingest({
        eventId: event.id,
        report,
        sourceIp: request.ip,
        origin: 'REPORTER',
        submittedBy,
        requireHost: true
      })
      : database.insertMatch(report, request.ip, event.id, {
        hostId: authentication.host?.id ?? null,
        origin: 'REPORTER',
        submittedBy
      });
    if (authentication.host) {
      database.competition.touchHostReporterToken(event.id, authentication.host.id);
    }
    return match;
  }

  app.get('/api/health', (_request, response, next) => {
    try {
      response.json({ status: 'ok', database: database.ping() ? 'ok' : 'error', uptimeSeconds: Math.round(process.uptime()) });
    } catch (error) { next(error); }
  });

  app.get('/api/events', (_request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json({ events: database.listEvents() }); }
    catch (error) { next(error); }
  });

  app.get('/api/events/:slug', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      const registrationFields = event.modules.registration
        ? database.listRegistrationFields(event.id, { publicOnly: true })
        : [];
      response.set('Cache-Control', 'no-store').json({
        event: {
          ...event,
          officialFormat: officialValorantFormatForSlug(event.slug),
          valorantPeakRanks: isValorant(event.game) ? VALORANT_PEAK_RANKS : []
        },
        registrationFields
      });
    } catch (error) { next(error); }
  });

  app.post('/api/events/:slug/registrations', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (event.modules.draft) {
        return sendError(response, 404, 'REGISTRATION_FLOW_UNAVAILABLE',
          'Este evento utiliza inscripción con Discord y Riot ID.');
      }
      const participant = database.createParticipant(event.id, request.body?.values);
      response.status(201).json({ participant: publicParticipant(participant), message: 'Inscripción recibida. Queda pendiente de confirmación.' });
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/participants', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (!event.modules.participants) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no publica participantes.');
      const participants = database.listParticipants(event.id, { publicView: true });
      response.json({ participants, count: participants.length });
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/leaderboard', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (!event.modules.leaderboard) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no utiliza clasificación.');
      response.json(buildLeaderboard(database.listAllMatches(event.id)));
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/competition', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response); if (!event) return;
      if (!event.modules.competition) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no utiliza fases competitivas.');
      const stages = database.competition.listStages(event.id).filter((stage) => stage.enabled).map((stage) => {
        const groups = stage.groups.map((group) => ({ ...group, leaderboard: database.competition.getStageLeaderboard(stage.id, group.id) }));
        const leaderboard = stage.type === 'group_stage' ? null : database.competition.getStageLeaderboard(stage.id);
        return { ...stage, groups, leaderboard, mapSchedule: mapScheduleForStage(stage) };
      });
      const champion = stages.flatMap((stage) => stage.participants).find((participant) => participant.competitiveStatus === 'champion') || null;
      response.set('Cache-Control', 'no-store').json({ stages, champion });
    } catch (error) { next(error); }
  });
  app.get('/api/events/:slug/stages/:stageId/leaderboard', (request, response, next) => {
    try { const event=eventFromSlug(request,response);if(!event)return;if(!event.modules.competition)return sendError(response,404,'MODULE_DISABLED','Este evento no utiliza fases competitivas.');const stageId=parseId(request.params.stageId);if(!stageId)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');const groupId=request.query.groupId===undefined?null:parseId(request.query.groupId);if(request.query.groupId!==undefined&&!groupId)return sendError(response,400,'INVALID_GROUP_ID','El id de grupo no es válido.');const stage=database.competition.getStage(stageId);if(stage.eventId!==event.id)return sendError(response,404,'STAGE_NOT_FOUND','La fase no existe.');if(stage.type==='group_stage'&&!groupId)return sendError(response,400,'GROUP_REQUIRED','Selecciona un grupo para esta clasificación.');response.json(database.competition.getStageLeaderboard(stageId,groupId)); } catch(error){next(error);}
  });
  app.get('/api/events/:slug/schedule', (request, response, next) => {
    try { const event=eventFromSlug(request,response);if(!event)return;if(!event.modules.schedule)return sendError(response,404,'MODULE_DISABLED','Este evento no publica agenda.');response.json({schedule:database.competition.listSchedule(event.id)}); } catch(error){next(error);}
  });
  app.get('/api/events/:slug/prizes', (request, response, next) => {
    try { const event=eventFromSlug(request,response);if(!event)return;if(!event.modules.prizes)return sendError(response,404,'MODULE_DISABLED','Este evento no publica premios.');response.json({prizes:database.competition.listPrizes(event.id,{publicOnly:true})}); } catch(error){next(error);}
  });

  function sendMatches(event, request, response, { publicView = true } = {}) {
    if (!event) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
    const limit = parseLimit(request.query.limit);
    if (limit === null) return sendError(response, 400, 'INVALID_LIMIT', 'limit debe ser un entero mayor que cero.');
    const matches = database.listMatches(limit, event.id);
    return response.json({ matches: publicView ? matches.map(publicMatch) : matches, count: database.countMatches(event.id), limit });
  }

  app.get('/api/events/:slug/matches', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (!event.modules.matches) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no publica partidas.');
      sendMatches(event, request, response);
    } catch (error) { next(error); }
  });

  app.post('/api/events/:slug/matches', (request, response, next) => {
    if (!isReport(request.body)) return sendError(response, 400, 'INVALID_REPORT', 'El cuerpo debe ser un objeto JSON no vacio.');
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (!event.modules.matches) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no utiliza partidas.');
      const match = ingestReporterMatch({ event, report: request.body, request });
      response.location(`/api/matches/${match.id}`).status(match.duplicate ? 200 : 201).json(publicMatch(match));
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/tournament-information', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
      if (!event.modules.information) return sendError(response, 404, 'MODULE_DISABLED', 'Este evento no publica información ampliada.');
      response.set('Cache-Control', 'no-store').json({
        event: { ...event, officialFormat: officialValorantFormatForSlug(event.slug) },
        ...database.getTournamentInformation(event.id),
        scoring: eventScoring(event)
      });
    } catch (error) { next(error); }
  });

  // El Reporter pregunta aquí qué fase, grupo y número de partida le tocan.
  // La credencial por host identifica evento y host, así que no necesita
  // ninguna información adicional en su archivo .ini.
  app.get('/api/reporter/context', (request, response, next) => {
    try {
      const authentication = reporterAuthorizer.authorizeWithoutEvent({
        hostId: request.get('x-host-id') || request.query.hostId,
        suppliedToken: readBearer(request)
      });
      const event = database.getEventById(authentication.eventId);
      if (!event) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      const context = reporterContextResolver.resolve({ event, host: authentication.host });
      response.set('Cache-Control', 'no-store').json(context);
    } catch (error) { next(error); }
  });

  // Compatibility API: the original Among Us event remains the default target.
  app.get('/api/tournament-information', (_request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json({ ...database.getTournamentInformation(), scoring: scoringPayload() }); }
    catch (error) { next(error); }
  });
  app.post('/api/matches', (request, response, next) => {
    if (!isReport(request.body)) return sendError(response, 400, 'INVALID_REPORT', 'El cuerpo debe ser un objeto JSON no vacio.');
    try {
      const { eventSlug, eventId, ...reportWithoutContext } = request.body;
      const event = eventId ? database.getEventById(Number(eventId)) : (eventSlug ? database.getEventBySlug(eventSlug) : database.getDefaultEvent());
      if (!event || event.archived) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      if (!event.modules.matches) return sendError(response, 403, 'MATCHES_DISABLED', 'Este evento no admite resultados.');
      const report = eventSlug || eventId ? { ...reportWithoutContext, eventId: event?.id } : request.body;
      if (!isReport(report)) return sendError(response, 400, 'INVALID_REPORT', 'Faltan los datos de la partida.');
      const match = ingestReporterMatch({ event, report, request });
      response.location(`/api/matches/${match.id}`).status(match.duplicate ? 200 : 201).json(publicMatch(match));
    } catch (error) { next(error); }
  });
  app.get('/api/matches', (request, response, next) => {
    try { sendMatches(database.getDefaultEvent(), request, response); }
    catch (error) { next(error); }
  });
  app.get('/api/leaderboard', (_request, response, next) => {
    try { response.json(buildLeaderboard(database.listAllMatches())); }
    catch (error) { next(error); }
  });
  app.get('/api/matches/:id', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_MATCH_ID', 'El id de partida no es valido.');
    try {
      const event = database.getDefaultEvent();
      const match = database.getMatch(id);
      if (!match || match.eventId !== event.id || !event.modules.matches || event.archived) {
        return sendError(response, 404, 'MATCH_NOT_FOUND', 'No existe esa partida.');
      }
      response.json(publicMatch(match));
    } catch (error) { next(error); }
  });

  app.use('/api/admin', (request, response, next) => {
    if (!adminToken) return sendError(response, 503, 'ADMIN_NOT_CONFIGURED', 'Configura ADMIN_TOKEN en el servidor antes de editar.');
    const authorization = request.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!tokensMatch(suppliedToken, adminToken)) return sendError(response, 401, 'ADMIN_UNAUTHORIZED', 'Token de administración incorrecto.');
    next();
  });

  app.get('/api/admin/events', (_request, response, next) => {
    try { response.json({ events: database.listEvents({ includeArchived: true }) }); }
    catch (error) { next(error); }
  });
  app.post('/api/admin/events', (request, response, next) => {
    try { response.status(201).json({ event: database.createEvent(request.body) }); }
    catch (error) { next(error); }
  });
  app.put('/api/admin/events/:id', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try { response.json({ event: database.updateEvent(id, request.body) }); }
    catch (error) { next(error); }
  });
  app.delete('/api/admin/events/:id', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try { response.json({ event: database.archiveEvent(id) }); }
    catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/stages', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_EVENT_ID','El id de evento no es válido.');
    try { if(!database.getEventById(id))return sendError(response,404,'EVENT_NOT_FOUND','El evento no existe.');response.json({stages:database.competition.listStages(id)}); } catch(error){next(error);}
  });
  app.post('/api/admin/events/:id/stages', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_EVENT_ID','El id de evento no es válido.');
    try { response.status(201).json({stage:database.competition.createStage(id,request.body)}); } catch(error){next(error);}
  });
  app.put('/api/admin/stages/:id', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json({stage:database.competition.updateStage(id,request.body)}); } catch(error){next(error);}
  });
  app.put('/api/admin/stages/:id/groups', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json({groups:database.competition.replaceGroups(id,request.body?.groups||[])}); } catch(error){next(error);}
  });
  app.post('/api/admin/stages/:id/groups/distribute', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json({participants:database.competition.distributeGroups(id)}); } catch(error){next(error);}
  });
  app.patch('/api/admin/stages/:id/groups/lock', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json({stage:database.competition.setGroupsLocked(id,Boolean(request.body?.locked))}); } catch(error){next(error);}
  });
  app.put('/api/admin/stages/:stageId/participants/:participantId', (request, response, next) => {
    const stageId=parseId(request.params.stageId),participantId=parseId(request.params.participantId);if(!stageId||!participantId)return sendError(response,400,'INVALID_PARTICIPANT_ID','Los identificadores no son válidos.');
    try { const groupId=request.body?.groupId===null?null:parseId(request.body?.groupId);response.json({participants:database.competition.assignParticipant(stageId,participantId,groupId)}); } catch(error){next(error);}
  });
  app.get('/api/admin/stages/:id/leaderboard', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json(database.competition.getStageLeaderboard(id,request.query.groupId?parseId(request.query.groupId):null)); } catch(error){next(error);}
  });
  app.get('/api/admin/stages/:id/close-preview', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json(database.competition.previewStageCompletion(id)); } catch(error){next(error);}
  });
  app.post('/api/admin/stages/:id/complete', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.json(database.competition.completeStage(id,{force:Boolean(request.body?.force)})); } catch(error){next(error);}
  });
  app.post('/api/admin/stages/:id/tie-resolutions', (request, response, next) => {
    const id=parseId(request.params.id);if(!id)return sendError(response,400,'INVALID_STAGE_ID','El id de fase no es válido.');
    try { response.status(201).json({resolutions:database.competition.resolveTie(id,request.body||{})}); } catch(error){next(error);}
  });
  app.get('/api/admin/events/:id/hosts', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      const event = database.getEventById(id);
      if (!event) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      const hosts = database.competition.listHosts(id).map((host) => ({
        ...host,
        reporterContext: reporterContextResolver.resolve({ event, host, includeRoster: false })
      }));
      response.json({ hosts });
    } catch (error) { next(error); }
  });
  app.put('/api/admin/events/:id/hosts', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({hosts:database.competition.replaceHosts(id,request.body?.hosts||[])});}catch(error){next(error);}});
  app.post('/api/admin/events/:eventId/hosts/:hostId/token', (request, response, next) => {
    const eventId = parseId(request.params.eventId);
    if (!eventId) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    if (!reporterPrivateUrl) return sendError(response, 503, 'REPORTER_PRIVATE_URL_NOT_CONFIGURED', 'Configura REPORTER_PRIVATE_URL antes de crear credenciales Reporter.');
    try {
      const host = database.competition.getHost(eventId, /^\d+$/.test(request.params.hostId) ? Number(request.params.hostId) : request.params.hostId);
      if (!host) return sendError(response, 404, 'HOST_NOT_FOUND', 'El host no pertenece al evento.');
      const token = generateReporterToken();
      const updatedHost = database.competition.setHostReporterToken(eventId, host.id, {
        tokenHash: hashReporterToken(token)
      });
      const reporterConfig = `ServerUrl=${reporterPrivateUrl}\nHostId=${updatedHost.identifier}\nReporterToken=${token}\n`;
      response.set('Cache-Control', 'no-store').status(201).json({ host: updatedHost, token, reporterConfig });
    } catch (error) { next(error); }
  });
  app.delete('/api/admin/events/:eventId/hosts/:hostId/token', (request, response, next) => {
    const eventId = parseId(request.params.eventId);
    if (!eventId) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      const host = database.competition.getHost(eventId, /^\d+$/.test(request.params.hostId) ? Number(request.params.hostId) : request.params.hostId);
      if (!host) return sendError(response, 404, 'HOST_NOT_FOUND', 'El host no pertenece al evento.');
      response.json({ host: database.competition.revokeHostReporterToken(eventId, host.id) });
    } catch (error) { next(error); }
  });
  app.put('/api/admin/events/:eventId/hosts/:hostId/assignment', (request, response, next) => {
    const eventId = parseId(request.params.eventId);
    if (!eventId) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      const host = database.competition.getHost(eventId, /^\d+$/.test(request.params.hostId) ? Number(request.params.hostId) : request.params.hostId);
      if (!host) return sendError(response, 404, 'HOST_NOT_FOUND', 'El host no pertenece al evento.');
      const updated = database.competition.setHostAssignment(eventId, host.id, {
        stageId: request.body?.stageId ?? null,
        groupId: request.body?.groupId ?? null
      });
      const event = database.getEventById(eventId);
      response.json({ host: updated, context: reporterContextResolver.resolve({ event, host: updated, includeRoster: false }) });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/schedule', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({schedule:database.competition.listSchedule(id)});}catch(error){next(error);}});
  app.put('/api/admin/events/:id/schedule', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({schedule:database.competition.replaceSchedule(id,request.body?.schedule||[])});}catch(error){next(error);}});
  app.get('/api/admin/events/:id/prizes', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({prizes:database.competition.listPrizes(id)});}catch(error){next(error);}});
  app.put('/api/admin/events/:id/prizes', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({prizes:database.competition.replacePrizes(id,request.body?.prizes||[])});}catch(error){next(error);}});
  app.post('/api/admin/events/:id/simulator', (request,response,next)=>{const id=parseId(request.params.id);try{const match=matchIngestor.ingest({eventId:id,report:request.body?.report||request.body,context:request.body?.context||{},sourceIp:request.ip,origin:'SIMULATOR',submittedBy:'ADMIN'});response.status(match.duplicate?200:201).json({match});}catch(error){next(error);}});
  app.post('/api/admin/events/:id/recalculate', (request,response,next)=>{const id=parseId(request.params.id);try{response.json({stages:database.competition.listStages(id).map((stage)=>({stage,leaderboards:stage.type==='group_stage'?stage.groups.map((group)=>database.competition.getStageLeaderboard(stage.id,group.id)):[database.competition.getStageLeaderboard(stage.id)]}))});}catch(error){next(error);}});
  app.get('/api/admin/events/:id/fields', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try { response.json({ fields: database.listRegistrationFields(id) }); }
    catch (error) { next(error); }
  });
  app.put('/api/admin/events/:id/fields', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try { response.json({ fields: database.replaceRegistrationFields(id, request.body?.fields) }); }
    catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/participants', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      const participants = database.listParticipants(id);
      response.json({ participants, count: participants.length });
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/participants/:id', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_PARTICIPANT_ID', 'El id de inscripción no es válido.');
    try { response.json({ participant: database.updateParticipant(id, request.body) }); }
    catch (error) { next(error); }
  });
  app.delete('/api/admin/participants/:id', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_PARTICIPANT_ID', 'El id de inscripción no es válido.');
    try {
      if (!database.deleteParticipant(id)) return sendError(response, 404, 'PARTICIPANT_NOT_FOUND', 'La inscripción no existe.');
      response.json({ deleted: true });
    } catch (error) { next(error); }
  });
  app.put('/api/admin/events/:id/information', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      if (!request.body?.information) throw new InformationValidationError('Falta information.');
      response.json(database.updateTournamentInformation(request.body.information, id));
    } catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/information', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      const event = database.getEventById(id);
      if (!event) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      response.json({ ...database.getTournamentInformation(id), scoring: eventScoring(event) });
    }
    catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/leaderboard', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try {
      if (!database.getEventById(id)) return sendError(response, 404, 'EVENT_NOT_FOUND', 'El evento no existe.');
      response.json(buildLeaderboard(database.listAllMatches(id)));
    } catch (error) { next(error); }
  });
  app.get('/api/admin/events/:id/matches', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    try { sendMatches(database.getEventById(id), request, response, { publicView: false }); }
    catch (error) { next(error); }
  });
  app.post('/api/admin/events/:id/matches', (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return sendError(response, 400, 'INVALID_EVENT_ID', 'El id de evento no es válido.');
    if (!isReport(request.body?.report)) return sendError(response, 400, 'INVALID_REPORT', 'Falta report.');
    try { const report=request.body.report,context=request.body.context||{};const match=hasCompetitiveContext({...report,...context})?matchIngestor.ingest({eventId:id,report,context,sourceIp:request.ip,origin:'MANUAL',submittedBy:'ADMIN'}):database.insertMatch(report,request.ip,id,{origin:'MANUAL',submittedBy:'ADMIN'});response.status(match.duplicate?200:201).json(match); }
    catch (error) { next(error); }
  });
  app.delete('/api/admin/events/:eventId/matches/:matchId', (request, response, next) => {
    const eventId = parseId(request.params.eventId);
    const matchId = parseId(request.params.matchId);
    if (!eventId || !matchId) return sendError(response, 400, 'INVALID_MATCH_ID', 'El id no es válido.');
    try {
      if (!database.deleteMatch(matchId, eventId)) return sendError(response, 404, 'MATCH_NOT_FOUND', 'No existe esa partida en el evento.');
      response.json({ deleted: true });
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/events/:eventId/matches/:matchId/void', (request, response, next) => {
    const eventId=parseId(request.params.eventId),matchId=parseId(request.params.matchId);
    if(!eventId||!matchId)return sendError(response,400,'INVALID_MATCH_ID','El id no es válido.');
    try { if(!database.voidMatch(matchId,eventId,request.body?.reason))return sendError(response,404,'MATCH_NOT_FOUND','No existe esa partida en el evento.');response.json({match:database.getMatch(matchId)}); } catch(error){next(error);}
  });
  app.put('/api/admin/tournament-information', (request, response, next) => {
    try {
      if (!request.body?.information) throw new InformationValidationError('Falta information.');
      response.json(database.updateTournamentInformation(request.body.information));
    } catch (error) { next(error); }
  });

  // ---------------------------------------------------------------- Discord
  // Identidad del participante. Es un dominio de autenticación distinto del
  // token de administración y no se mezclan.

  /**
   * Un evento sólo admite draft y equipos si lleva ese módulo activado. Sin
   * esto, `/api/events/torneo-among-us/valorant/registrations` crearía una
   * inscripción con Riot ID dentro de un torneo individual.
   */
  function draftEventFromSlug(request, response) {
    const event = eventFromSlug(request, response);
    if (!event) return null;
    if (!event.modules.draft) {
      sendError(response, 404, 'MODULE_DISABLED', 'Este evento no utiliza draft por equipos.');
      return null;
    }
    return event;
  }

  /**
   * Lo mismo, pero para lo que ve cualquiera. Tener el módulo encendido no hace
   * público el draft: mientras el evento siga anunciado y sin abrir, quién es
   * capitán o cómo van los equipos no debe poder averiguarse por la API.
   */
  function publicDraftEventFromSlug(request, response) {
    const event = draftEventFromSlug(request, response);
    if (!event) return null;
    if (event.status === 'Próximamente') {
      sendError(response, 404, 'EVENT_NOT_PUBLISHED', 'Este evento todavía no está abierto.');
      return null;
    }
    return event;
  }

  /** Y la inscripción de Riot ID sólo tiene sentido en un torneo de Valorant. */
  function valorantEventFromSlug(request, response) {
    const event = draftEventFromSlug(request, response);
    if (!event) return null;
    if (!isValorant(event.game)) {
      sendError(response, 404, 'MODULE_DISABLED', 'Este evento no usa inscripción de Valorant.');
      return null;
    }
    return event;
  }

  function currentSession(request) {
    const id = readSessionCookie(request.headers.cookie);
    return id ? database.valorant.getSession(id) : null;
  }

  app.get('/api/auth/discord/status', (_request, response) => {
    response.json(discordProvider.describe());
  });

  app.get('/auth/discord', (request, response, next) => {
    try {
      if (!discordProvider.configured) {
        return sendError(response, 503, 'DISCORD_NOT_CONFIGURED',
          'El acceso con Discord todavía no está configurado.');
      }
      // Se valida antes de guardarlo, no al usarlo: lo que entra en la base
      // ya es una ruta interna.
      const { state, nonce } = database.valorant.createOAuthState({
        redirectTo: safeReturnPath(request.query.redirect, '/')
      });
      // El nonce ata este intento a este navegador.
      response.setHeader('Set-Cookie', oauthNonceCookie(nonce, { secure: secureCookies }));
      response.redirect(302, discordProvider.authorizeUrl(state));
    } catch (error) { next(error); }
  });

  app.get('/auth/discord/callback', async (request, response, next) => {
    try {
      if (!discordProvider.configured) {
        return sendError(response, 503, 'DISCORD_NOT_CONFIGURED',
          'El acceso con Discord todavía no está configurado.');
      }
      // Se consume aquí, y sólo vale si lo termina el mismo navegador que lo
      // empezó: hace falta el state de la URL y el nonce de la cookie.
      const nonce = readOAuthNonceCookie(request.headers.cookie);
      const state = database.valorant.consumeOAuthState(request.query.state, nonce);
      if (!state) {
        response.setHeader('Set-Cookie', clearedOAuthNonceCookie({ secure: secureCookies }));
        return sendError(response, 400, 'OAUTH_STATE_INVALID',
          'La petición de acceso no es válida o ha caducado. Vuelve a intentarlo.');
      }

      const identity = await discordProvider.exchange(request.query.code);
      const account = database.valorant.upsertDiscordAccount(identity);
      const sessionToken = database.valorant.createSession(account.id);

      response.setHeader('Set-Cookie', [
        clearedOAuthNonceCookie({ secure: secureCookies }),
        sessionCookie(sessionToken, { secure: secureCookies })
      ]);
      response.redirect(302, state.redirectTo || '/');
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', (request, response, next) => {
    try {
      const id = readSessionCookie(request.headers.cookie);
      if (id) database.valorant.destroySession(id);
      response.setHeader('Set-Cookie', clearedSessionCookie({ secure: secureCookies }));
      response.json({ loggedOut: true });
    } catch (error) { next(error); }
  });

  /**
   * Lo que el navegador necesita para decidir qué enseñar. Con `?event=slug`
   * añade el estado en ese evento. Nunca sale de aquí el id de Discord, el de
   * cuenta, la sesión ni nada interno.
   */
  app.get('/api/me', (request, response, next) => {
    try {
      const session = currentSession(request);
      if (!session) return response.json({ authenticated: false });

      const payload = {
        authenticated: true,
        displayName: session.account.displayName || session.account.username,
        // Sin avatar: la URL del CDN de Discord lleva el id dentro, así que
        // publicarla es publicar el id por mucho que no exista el campo. Servirlo
        // sin filtrarlo exigiría copiar la imagen a nuestro lado, y eso no toca
        // en este bloque. La interfaz usa las iniciales del nombre.
        avatar: null
      };

      const slug = typeof request.query.event === 'string' ? request.query.event : null;
      if (slug) {
        const event = database.getEventBySlug(slug);
        if (event) {
          const registro = database.valorant.publicRegistration(event.id, session.account.id);
          payload.event = {
            slug: event.slug,
            registrationsOpen: event.registration.available,
            registrationLabel: event.registration.label,
            registered: Boolean(registro),
            participantId: registro?.participantId ?? null,
            registrationStatus: registro?.status ?? null,
            riotId: registro?.riotId ?? null,
            peakRank: registro?.peakRank ?? null,
            playerBio: registro?.playerBio ?? null,
            // En un evento sin draft no se inventa un papel que no existe.
            draftRole: event.modules.draft
              ? database.valorant.draftRole(event.id, registro?.participantId)
              : null
          };
        }
      }

      response.json(payload);
    } catch (error) { next(error); }
  });

  /**
   * Añade a una inscripción lo que su dueño querría ver: con quién juega,
   * contra quién y cómo va su equipo.
   *
   * De los compañeros sale **sólo el nombre visible**, que ya es público en la
   * página del draft. Ni Riot ID, ni Friend Code, ni identificadores de
   * Discord: que sea mi perfil no me da acceso a los datos de los demás.
   */
  function enrichRegistration(registro) {
    if (!registro.team?.id) return registro;
    try {
      const equipos = database.valorant.listTeams(registro.eventId);
      const propio = equipos.find((equipo) => equipo.id === registro.team.id);
      const snapshot = database.valorantCompetition.teamSnapshot(
        registro.eventId, registro.team.id, { teams: equipos });

      return {
        ...registro,
        team: {
          ...registro.team,
          members: (propio?.members || []).map((miembro) => ({
            displayName: miembro.displayName ?? miembro.display_name ?? null,
            role: miembro.role === 'captain' ? 'captain' : 'participant'
          }))
        },
        standing: snapshot.standing,
        seriesPlayed: snapshot.seriesPlayed ?? null,
        seriesTotal: snapshot.seriesTotal ?? null,
        nextMatch: snapshot.nextMatch
      };
    } catch {
      // Un evento sin competición montada no es un error del perfil.
      return registro;
    }
  }

  app.get('/api/me/profile', (request, response, next) => {
    try {
      const session = currentSession(request);
      response.set('Cache-Control', 'no-store');
      if (!session) return response.json({ authenticated: false });
      response.json({
        authenticated: true,
        displayName: session.account.displayName || session.account.username,
        // La ruta propia entrega los píxeles sin revelar el id ni el hash de Discord.
        avatar: session.account.avatar ? '/api/me/avatar' : null,
        registrations: database.valorant.profileRegistrations(session.account.id)
          .map((registro) => enrichRegistration(registro))
      });
    } catch (error) { next(error); }
  });

  app.get('/api/me/avatar', async (request, response) => {
    const session = currentSession(request);
    if (!session) return sendError(response, 401, 'AUTH_REQUIRED', 'Entra con Discord para ver tu avatar.');
    const { discordUserId, avatar } = session.account;
    if (!discordUserId || !avatar) {
      return sendError(response, 404, 'AVATAR_NOT_FOUND', 'Esta cuenta no tiene avatar de Discord.');
    }

    try {
      const id = encodeURIComponent(String(discordUserId));
      const hash = encodeURIComponent(String(avatar));
      const upstream = await discordAvatarFetch(
        `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256`,
        { headers: { Accept: 'image/png' }, signal: AbortSignal.timeout(5000) }
      );
      const contentType = upstream.headers.get('content-type') || '';
      const contentLength = Number(upstream.headers.get('content-length') || 0);
      if (!upstream.ok || !/^image\/(png|jpeg|webp|gif)(;|$)/i.test(contentType) || contentLength > 2 * 1024 * 1024) {
        return sendError(response, 502, 'AVATAR_UNAVAILABLE', 'No se ha podido obtener el avatar de Discord.');
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024) {
        return sendError(response, 502, 'AVATAR_UNAVAILABLE', 'El avatar de Discord supera el tamaño permitido.');
      }
      response.set({
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300, no-transform'
      });
      return response.send(bytes);
    } catch {
      return sendError(response, 502, 'AVATAR_UNAVAILABLE', 'No se ha podido obtener el avatar de Discord.');
    }
  });

  /**
   * Inscripción de Valorant. El cuerpo sólo trae lo que escribe la persona: la
   * cuenta sale de la cookie, así que nadie puede adjudicarse una inscripción
   * ajena mandando un id.
   */
  app.post('/api/events/:slug/valorant/registrations', (request, response, next) => {
    try {
      const event = valorantEventFromSlug(request, response);
      if (!event) return;

      const session = currentSession(request);
      if (!session) {
        return sendError(response, 401, 'AUTH_REQUIRED', 'Entra con Discord para inscribirte.');
      }

      const registro = database.valorant.registerWithDiscord(event.id, {
        discordAccountId: session.account.id,
        riotId: request.body?.riotId,
        // Lo que el navegador diga sobre identidad se ignora por completo.
        values: {
          peak_rank: request.body?.peakRank ?? 'Sin rango',
          player_bio: request.body?.playerBio ?? ''
        }
      }, (eventId, values) => database.createParticipant(eventId, values));

      response.status(201).json({ registration: registro });
    } catch (error) { next(error); }
  });

  // ---------------------------------------------------------------- draft
  app.get('/api/events/:slug/draft', (request, response, next) => {
    try {
      const event = publicDraftEventFromSlug(request, response);
      if (!event) return;
      const state = database.valorant.publicDraftState(event.id);
      if (!state) return sendError(response, 404, 'DRAFT_NOT_FOUND', 'Este evento no tiene draft.');
      response.json(state);
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/teams', (request, response, next) => {
    try {
      const event = publicDraftEventFromSlug(request, response);
      if (!event) return;
      response.json({ teams: database.valorant.listTeams(event.id) });
    } catch (error) { next(error); }
  });

  /**
   * La elección. Sólo se acepta a quién eliges: quién eres sale de la sesión.
   * Nada que venga del navegador decide si eres capitán o si es tu turno.
   */
  app.post('/api/events/:slug/draft/pick', (request, response, next) => {
    try {
      const event = publicDraftEventFromSlug(request, response);
      if (!event) return;

      const session = currentSession(request);
      if (!session) {
        return sendError(response, 401, 'AUTH_REQUIRED', 'Entra con Discord para participar en el draft.');
      }
      const participant = database.valorant.findParticipantByDiscord(event.id, session.account.id);
      if (!participant) {
        return sendError(response, 403, 'NOT_A_PARTICIPANT', 'Tu cuenta no está inscrita en este evento.');
      }

      const result = database.valorant.pick(event.id, {
        captainParticipantId: participant.id,
        selectedParticipantId: request.body?.selectedParticipantId
      });
      // Primero está guardado; sólo entonces se avisa.
      draftStream.publish(event.id, result.draft.status === 'COMPLETED' ? 'draft_completed' : 'pick_made');
      response.status(201).json({
        pick: {
          pickNumber: result.pickNumber, roundNumber: result.roundNumber,
          teamId: result.teamId, participantId: result.participantId, displayName: result.displayName
        },
        draft: database.valorant.publicDraftState(event.id)
      });
    } catch (error) { next(error); }
  });

  /**
   * Avisos en directo. Sólo lleva el tipo de cambio y una revisión: el estado
   * se pide por la ruta pública, así que por aquí no puede escaparse nada
   * privado aunque alguien añada un campo sin darse cuenta.
   */
  app.get('/api/events/:slug/draft/stream', (request, response) => {
    const event = publicDraftEventFromSlug(request, response);
    if (!event) return;
    draftStream.attach(event.id, request, response);
  });

  /**
   * El capitán le pone nombre a SU equipo. No recibe qué equipo: se deduce de
   * quién es, así que no hay forma de renombrar el de otro.
   */
  app.patch('/api/events/:slug/my-team', (request, response, next) => {
    try {
      const event = publicDraftEventFromSlug(request, response);
      if (!event) return;

      const session = currentSession(request);
      if (!session) return sendError(response, 401, 'AUTH_REQUIRED', 'Entra con Discord.');

      const participant = database.valorant.findParticipantByDiscord(event.id, session.account.id);
      const team = participant
        ? database.valorant.teamCaptainedBy(event.id, participant.id)
        : null;
      if (!team) {
        return sendError(response, 403, 'NOT_A_CAPTAIN', 'Sólo el capitán puede cambiar el nombre de su equipo.');
      }

      const actualizado = database.valorant.renameTeam(event.id, {
        teamId: team.id, name: request.body?.name, actor: `captain:${participant.id}`,
        requireCompletedDraft: true
      });
      draftStream.publish(event.id, 'team_updated');
      response.json({ team: actualizado });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/teams/rename', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const team = database.valorant.renameTeam(id, {
        teamId: request.body?.teamId,
        name: request.body?.name,
        reason: request.body?.reason
      });
      draftStream.publish(id, 'team_updated');
      response.json({ team });
    } catch (error) { next(error); }
  });

  // ------------------------------------------------------- fase regular
  app.get('/api/events/:slug/competition-teams', (request, response, next) => {
    try {
      const event = publicDraftEventFromSlug(request, response);
      if (!event) return;
      const teams = database.valorant.listTeams(event.id);
      response.json({
        format: officialValorantFormatForSlug(event.slug),
        ...database.valorantCompetition.publicCompetitionState(event.id, teams),
        playoffs: database.valorantPlayoffs.publicState(event.id, teams)
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/events/:id/competition', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const event = database.getEventById(id);
      response.json({
        format: officialValorantFormatForSlug(event?.slug),
        maps: database.valorantCompetition.listMaps(id),
        mapPolicy: database.valorantCompetition.getMapAnnouncement(id),
        settings: database.valorantCompetition.getSettings(id),
        matchdays: database.valorantCompetition.matchdays(id),
        teams: database.valorant.listTeams(id),
        draft: database.valorant.getDraft(id) ?? null
      });
    } catch (error) { next(error); }
  });

  app.put('/api/admin/events/:id/competition/maps', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const maps = database.valorantCompetition.setMapPool(id, request.body?.enabled);
      draftStream.publish(id, 'competition_updated');
      response.json({ maps });
    } catch (error) { next(error); }
  });

  app.put('/api/admin/events/:id/competition/settings', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      response.json({
        settings: database.valorantCompetition.setSettings(id, {
          tiebreakers: request.body?.tiebreakers, qualifiers: request.body?.qualifiers
        })
      });
    } catch (error) { next(error); }
  });

  /*
    Desempates que resuelve la organización. La aplicación detecta el empate y
    se niega a sembrar al azar; esto es lo que le da salida.
  */
  app.get('/api/admin/events/:id/competition/tie-resolutions', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      response.json({
        resolutions: database.valorantCompetition.listTieResolutions(
          id, request.query.stage || 'REGULAR')
      });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/competition/tie-resolutions', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      response.status(201).json({
        resolutions: database.valorantCompetition.resolveTie(id, {
          higherTeamId: request.body?.higherTeamId,
          lowerTeamId: request.body?.lowerTeamId,
          reason: request.body?.reason,
          stage: request.body?.stage || 'REGULAR',
          actor: 'admin'
        })
      });
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/events/:id/competition/tie-resolutions', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      response.json({
        resolutions: database.valorantCompetition.clearTieResolution(id, {
          higherTeamId: request.body?.higherTeamId,
          lowerTeamId: request.body?.lowerTeamId,
          stage: request.body?.stage || 'REGULAR',
          actor: 'admin'
        })
      });
    } catch (error) { next(error); }
  });

  /** Los equipos del evento, comprobando que el draft ha terminado. */
  function teamsReadyForSeason(id, response) {
    const draft = database.valorant.getDraft(id);
    if (!draft || draft.status !== 'COMPLETED') {
      sendError(response, 409, 'DRAFT_NOT_COMPLETED',
        'La fase regular se genera cuando el draft ha terminado.');
      return null;
    }
    const teams = database.valorant.listTeams(id);
    if (teams.some((team) => team.members.length !== draft.teamSize)) {
      sendError(response, 409, 'TEAMS_INCOMPLETE', 'Hay equipos incompletos.');
      return null;
    }
    return teams;
  }

  /**
   * Genera la fase regular. Nunca borra: si ya existe, 409. Un `force` en el
   * cuerpo no hace nada aquí a propósito — rehacer tiene su propia ruta.
   */
  app.post('/api/admin/events/:id/competition/generate', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const teams = teamsReadyForSeason(id, response);
      if (!teams) return;

      const series = database.valorantCompetition.generateRegularSeason(
        id, teams.map((team) => team.id));
      draftStream.publish(id, 'competition_updated');
      response.status(201).json({ series, matchdays: database.valorantCompetition.matchdays(id) });
    } catch (error) { next(error); }
  });

  /**
   * Rehace el calendario y BORRA los resultados. Ruta aparte y con confirmación
   * escrita: un booleano suelto en un cuerpo JSON no puede tirar la fase regular.
   */
  app.post('/api/admin/events/:id/competition/regenerate', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const teams = teamsReadyForSeason(id, response);
      if (!teams) return;

      const hecho = database.valorantCompetition.regenerateRegularSeason(
        id, teams.map((team) => team.id), {
          reason: request.body?.reason ?? null,
          confirmation: request.body?.confirmation ?? null
        });
      draftStream.publish(id, 'competition_updated');
      response.json({
        series: hecho.series,
        discardedResults: hecho.discardedResults,
        matchdays: database.valorantCompetition.matchdays(id)
      });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/competition/map', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const series = database.valorantCompetition.assignMap(id, {
        seriesId: request.body?.seriesId,
        gameNumber: request.body?.gameNumber ?? 1,
        mapKey: request.body?.mapKey
      });
      draftStream.publish(id, 'competition_updated');
      response.json({ series });
    } catch (error) { next(error); }
  });

  const resultadoYTabla = (id, series) => ({
    series,
    standings: database.valorantCompetition.standings(id, { teams: database.valorant.listTeams(id) })
  });

  /**
   * Resultado manual: el respaldo de emergencia, no la vía normal.
   *
   * Sólo crea. Ni `correct`, ni `allowOverwrite`, ni `winnerTeamId` del cuerpo
   * se leen: ningún campo puede convertir una creación en una sobrescritura.
   */
  app.post('/api/admin/events/:id/competition/result', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const series = database.valorantCompetition.recordGameResult(id, {
        seriesId: request.body?.seriesId,
        gameNumber: request.body?.gameNumber ?? 1,
        teamARounds: request.body?.teamARounds,
        teamBRounds: request.body?.teamBRounds,
        source: 'MANUAL',
        reason: request.body?.reason
      });
      draftStream.publish(id, 'competition_updated');
      response.json(resultadoYTabla(id, series));
    } catch (error) { next(error); }
  });

  /** Corregir un resultado ya cerrado. Otra acción, otra ruta, otro registro. */
  app.post('/api/admin/events/:id/competition/result/correct', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const series = database.valorantCompetition.correctGameResult(id, {
        seriesId: request.body?.seriesId,
        gameNumber: request.body?.gameNumber ?? 1,
        teamARounds: request.body?.teamARounds,
        teamBRounds: request.body?.teamBRounds,
        source: 'MANUAL',
        reason: request.body?.reason
      });
      draftStream.publish(id, 'competition_updated');
      response.json(resultadoYTabla(id, series));
    } catch (error) { next(error); }
  });


  // ================================================== capturas de resultados

  /**
   * Las imágenes se quedan en memoria hasta que se validan. Nada llega al disco
   * con un nombre que haya elegido el cliente: multer no escribe archivos aquí,
   * y la clave de disco la genera el servidor después de comprobar la imagen.
   */
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: UPLOAD_LIMITS.maxFiles,
      fileSize: UPLOAD_LIMITS.maxBytesPerFile,
      fields: 8,
      parts: UPLOAD_LIMITS.maxFiles + 8
    },
    fileFilter(_request, file, done) {
      // Primer filtro barato por lo que dice el cliente; el que cuenta es el
      // de los magic bytes, que va después de leer los datos.
      if (!ALLOWED_MIME.includes(String(file.mimetype || '').toLowerCase())) {
        return done(new UploadError(
          'Sólo se admiten imágenes PNG, JPEG o WebP.', 'UNSUPPORTED_TYPE', 415));
      }
      done(null, true);
    }
  });

  /** El plantel de los dos equipos: los únicos candidatos posibles. */
  function rosterForSeries(eventId, serie) {
    const equipos = database.valorant.listTeams(eventId)
      .filter((equipo) => equipo.id === serie.teamAId || equipo.id === serie.teamBId);
    return equipos.flatMap((equipo) => equipo.members.map((miembro) => ({
      participantId: miembro.participantId,
      teamId: equipo.id,
      teamName: equipo.name,
      displayName: miembro.displayName,
      riotId: miembro.riotId ?? null
    })));
  }

  /** Vuelve a leer el lote entero y guarda la previsualización. */
  async function reprocesarLote(eventId, lote) {
    const serie = database.valorantCompetition.getSeries(eventId, lote.seriesId);
    const juego = serie?.games.find((g) => g.gameNumber === lote.gameNumber);

    const lecturas = [];
    for (const captura of lote.captures) {
      const imagen = await captureStorage.read(captura.storageKey);
      const leido = await readCapture(imagen, { ocrProvider: ocr, key: captura.sha256 });
      lecturas.push({ ...leido, captureId: captura.id });
    }

    const equipos = database.valorant.listTeams(eventId);
    const nombreDe = (id) => equipos.find((equipo) => equipo.id === id)?.name ?? null;

    const preview = buildPreview(lecturas, {
      roster: rosterForSeries(eventId, serie),
      expectedMap: juego?.mapKey ?? null,
      teamAId: serie.teamAId,
      teamBId: serie.teamBId,
      teamAName: nombreDe(serie.teamAId),
      teamBName: nombreDe(serie.teamBId)
    });

    return { preview, serie, juego };
  }

  app.post('/api/admin/events/:id/competition/captures',
    subida.array('captures', UPLOAD_LIMITS.maxFiles),
    async (request, response, next) => {
      const id = parseId(request.params.id);
      let lote = null;
      try {
        const archivos = request.files || [];
        if (archivos.length === 0) {
          return sendError(response, 400, 'NO_FILES', 'No has adjuntado ninguna imagen.');
        }
        const total = archivos.reduce((suma, archivo) => suma + archivo.size, 0);
        if (total > UPLOAD_LIMITS.maxBytesPerBatch) {
          return sendError(response, 413, 'BATCH_TOO_LARGE', 'Las imágenes suman demasiado.');
        }

        lote = database.valorantCaptures.createBatch(id, {
          seriesId: Number(request.body?.seriesId),
          gameNumber: Number(request.body?.gameNumber ?? 1)
        });

        for (const archivo of archivos) {
          // Aquí se decide de verdad si es una imagen: firma y decodificación.
          const info = await inspectImage(archivo.buffer, { declaredMime: archivo.mimetype });
          const storageKey = await captureStorage.save(archivo.buffer, {
            eventId: id, batchId: lote.id, format: info.format
          });
          const leido = await readCapture(archivo.buffer, { ocrProvider: ocr, key: info.sha256 });

          database.valorantCaptures.addCapture(lote.id, {
            storageKey,
            originalFilename: String(archivo.originalname || '').slice(0, 200),
            mimeType: info.mime,
            width: info.width,
            height: info.height,
            bytes: info.bytes,
            sha256: info.sha256,
            sourceKind: leido.sourceKind,
            ocrText: leido.ocr.text,
            ocrJson: { words: leido.ocr.words.slice(0, 800) },
            confidence: leido.confidence
          });
        }

        lote = database.valorantCaptures.getBatch(id, lote.id);
        const { preview } = await reprocesarLote(id, lote);
        const guardado = database.valorantCaptures.savePreview(id, lote.id, preview);

        response.status(201).json({ batch: guardado, preview });
      } catch (error) {
        // Si algo falla a mitad no se deja un lote a medias con archivos sueltos.
        if (lote) {
          try {
            await captureStorage.removeBatch(id, lote.id);
            database.valorantCaptures.discardBatch(id, lote.id, { reason: 'subida fallida' });
          } catch { /* el error de verdad es el otro */ }
        }
        next(error);
      }
    });

  app.get('/api/admin/events/:id/competition/captures', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      response.json({
        batches: database.valorantCaptures.listBatches(id, {
          seriesId: request.query.seriesId ? Number(request.query.seriesId) : null,
          gameNumber: request.query.gameNumber ? Number(request.query.gameNumber) : 1
        })
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/events/:id/competition/captures/:batchId', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const lote = database.valorantCaptures.getBatch(id, parseId(request.params.batchId));
      if (!lote) return sendError(response, 404, 'BATCH_NOT_FOUND', 'Ese lote no existe.');
      const serie = database.valorantCompetition.getSeries(id, lote.seriesId);
      response.json({ batch: lote, preview: lote.parsed, roster: rosterForSeries(id, serie), series: serie });
    } catch (error) { next(error); }
  });

  /**
   * La imagen sólo la ve administración. Una captura puede llevar overlays,
   * ventanas del escritorio o nombres que nadie ha dado permiso para publicar.
   */
  app.get('/api/admin/events/:id/competition/captures/:batchId/image/:captureId',
    async (request, response, next) => {
      const id = parseId(request.params.id);
      try {
        const lote = database.valorantCaptures.getBatch(id, parseId(request.params.batchId));
        if (!lote) return sendError(response, 404, 'BATCH_NOT_FOUND', 'Ese lote no existe.');
        const captura = lote.captures.find((c) => c.id === parseId(request.params.captureId));
        if (!captura) return sendError(response, 404, 'CAPTURE_NOT_FOUND', 'Esa captura no existe.');

        response.type(captura.mimeType);
        response.setHeader('Cache-Control', 'private, no-store');
        response.send(await captureStorage.read(captura.storageKey));
      } catch (error) { next(error); }
    });

  app.post('/api/admin/events/:id/competition/captures/:batchId/reprocess',
    async (request, response, next) => {
      const id = parseId(request.params.id);
      try {
        const lote = database.valorantCaptures.getBatch(id, parseId(request.params.batchId));
        if (!lote) return sendError(response, 404, 'BATCH_NOT_FOUND', 'Ese lote no existe.');
        if (lote.status === 'CONFIRMED') {
          return sendError(response, 409, 'BATCH_ALREADY_CONFIRMED',
            'Ese lote ya se confirmó.');
        }
        const { preview } = await reprocesarLote(id, lote);
        response.json({ batch: database.valorantCaptures.savePreview(id, lote.id, preview), preview });
      } catch (error) { next(error); }
    });

  /**
   * Guarda las correcciones hechas en pantalla.
   *
   * Sigue sin tocar el resultado oficial: es una propuesta editada. Se anota
   * qué campos ha cambiado una persona para poder enseñarlos marcados y no
   * confundir lo leído con lo corregido.
   */
  app.post('/api/admin/events/:id/competition/captures/:batchId/preview',
    (request, response, next) => {
      const id = parseId(request.params.id);
      try {
        const lote = database.valorantCaptures.getBatch(id, parseId(request.params.batchId));
        if (!lote) return sendError(response, 404, 'BATCH_NOT_FOUND', 'Ese lote no existe.');
        if (lote.status === 'CONFIRMED') {
          return sendError(response, 409, 'BATCH_ALREADY_CONFIRMED',
            'Ese lote ya se confirmó: para cambiar el resultado hay que corregirlo.');
        }

        const detectado = lote.parsed ?? {};
        const propuesta = request.body ?? {};
        const serie = database.valorantCompetition.getSeries(id, lote.seriesId);
        const permitidos = new Set(rosterForSeries(id, serie).map((p) => p.participantId));

        const editados = [];
        const anota = (campo, antes, ahora) => {
          if (ahora !== undefined && ahora !== null && String(ahora) !== String(antes ?? '')) {
            editados.push(campo);
          }
        };
        anota('map', detectado.map, propuesta.mapKey);
        anota('teamARounds', detectado.teamARounds, propuesta.teamARounds);
        anota('teamBRounds', detectado.teamBRounds, propuesta.teamBRounds);

        const jugadores = (propuesta.players ?? detectado.players ?? []).map((fila, indice) => {
          const original = (detectado.players ?? [])[indice] ?? {};
          const cambiados = [];
          for (const campo of ['participantId', 'agent', 'acs', 'kills', 'deaths', 'assists',
            'plusMinus', 'adr', 'hsPercent', 'kastPercent', 'firstKills', 'firstDeaths']) {
            if (fila[campo] !== undefined && String(fila[campo] ?? '') !== String(original[campo] ?? '')) {
              cambiados.push(campo);
            }
          }
          // Asociar a alguien que no juega este partido no se guarda ni aquí.
          if (fila.participantId && !permitidos.has(Number(fila.participantId))) {
            throw new CaptureError(
              'Ese jugador no pertenece a ninguno de los dos equipos.', 'PLAYER_NOT_IN_SERIES');
          }
          return { ...original, ...fila, editedFields: cambiados, detected: original };
        });

        const preview = {
          ...detectado,
          map: propuesta.mapKey ?? detectado.map,
          teamARounds: propuesta.teamARounds ?? detectado.teamARounds,
          teamBRounds: propuesta.teamBRounds ?? detectado.teamBRounds,
          players: jugadores,
          editedFields: editados,
          // Editado a mano deja de tener problemas automáticos, pero no se
          // marca READY solo: eso lo decide quien confirma.
          status: lote.status === 'REVIEW_REQUIRED' && editados.length ? 'READY' : lote.status
        };

        response.json({
          batch: database.valorantCaptures.savePreview(id, lote.id, preview), preview
        });
      } catch (error) { next(error); }
    });

  app.delete('/api/admin/events/:id/competition/captures/:batchId',
    async (request, response, next) => {
      const id = parseId(request.params.id);
      const batchId = parseId(request.params.batchId);
      try {
        const lote = database.valorantCaptures.discardBatch(id, batchId, {
          reason: request.body?.reason ?? null
        });
        await captureStorage.removeBatch(id, batchId);
        response.json({ discarded: lote.id });
      } catch (error) { next(error); }
    });

  /**
   * Confirmar es lo único que toca el resultado oficial.
   *
   * Lo que manda el navegador son correcciones sobre lo leído, no autoridad: se
   * vuelve a comprobar todo aquí. Que la previsualización dijera READY hace un
   * minuto no basta, porque entre medias pudo cambiar el mapa o el resultado.
   */
  app.post('/api/admin/events/:id/competition/captures/:batchId/confirm',
    async (request, response, next) => {
      const id = parseId(request.params.id);
      try {
        const lote = database.valorantCaptures.getBatch(id, parseId(request.params.batchId));
        if (!lote) return sendError(response, 404, 'BATCH_NOT_FOUND', 'Ese lote no existe.');

        // Confirmar dos veces no duplica nada: la segunda no hace trabajo.
        if (lote.status === 'CONFIRMED') {
          return response.json({
            batch: lote, alreadyConfirmed: true,
            series: database.valorantCompetition.getSeries(id, lote.seriesId)
          });
        }

        const serie = database.valorantCompetition.getSeries(id, lote.seriesId);
        if (!serie) return sendError(response, 404, 'SERIES_NOT_FOUND', 'La serie no existe.');
        const juego = serie.games.find((g) => g.gameNumber === lote.gameNumber);
        if (!juego) return sendError(response, 404, 'GAME_NOT_FOUND', 'Esa partida no existe.');
        if (juego.status === 'COMPLETED') {
          return sendError(response, 409, 'RESULT_ALREADY_RECORDED',
            'Esa partida ya tiene resultado. Corregirlo es otra acción.');
        }
        if (!juego.mapKey) {
          return sendError(response, 409, 'MAP_REQUIRED',
            'Asigna el mapa antes de importar el resultado.');
        }

        const propuesta = request.body ?? {};
        const mapa = String(propuesta.mapKey ?? lote.parsed?.map ?? '').toLowerCase();
        if (mapa !== juego.mapKey && propuesta.overrideMap !== true) {
          return sendError(response, 409, 'MAP_MISMATCH',
            `La captura dice ${mapa || 'otro mapa'} y el partido tiene ${juego.mapKey}.`);
        }
        if (propuesta.overrideMap === true && !String(propuesta.reason || '').trim()) {
          // Saltarse la comprobación del mapa es excepcional: se explica.
          return sendError(response, 400, 'REASON_REQUIRED',
            'Para importar con un mapa distinto hace falta un motivo.');
        }

        const roster = rosterForSeries(id, serie);
        const permitidos = new Map(roster.map((persona) => [persona.participantId, persona]));

        const jugadores = [];
        for (const fila of propuesta.players ?? []) {
          const participantId = Number(fila.participantId);
          if (!participantId) continue;                 // sin asociar: no entra
          const persona = permitidos.get(participantId);
          if (!persona) {
            return sendError(response, 400, 'PLAYER_NOT_IN_SERIES',
              'Hay un jugador que no pertenece a ninguno de los dos equipos.');
          }
          jugadores.push({
            participantId,
            teamId: persona.teamId,
            agent: fila.agent ?? null,
            acs: fila.acs, kills: fila.kills, deaths: fila.deaths, assists: fila.assists,
            plusMinus: fila.plusMinus, adr: fila.adr,
            hsPercent: fila.hsPercent, kastPercent: fila.kastPercent,
            firstKills: fila.firstKills, firstDeaths: fila.firstDeaths,
            extra: fila.extra ?? null,
            sourceCaptureId: fila.sourceCaptureId ?? null
          });
        }

        const series = database.valorantCompetition.recordGameResult(id, {
          seriesId: serie.id,
          gameNumber: lote.gameNumber,
          teamARounds: propuesta.teamARounds ?? lote.detectedTeamARounds,
          teamBRounds: propuesta.teamBRounds ?? lote.detectedTeamBRounds,
          source: 'SCREENSHOT',
          // Una captura confirmada trae su propia evidencia detrás; el motivo
          // sólo hace falta si se ha saltado alguna comprobación.
          reason: propuesta.reason ?? null,
          stats: jugadores.length ? jugadores : null,
          captureBatchId: lote.id
        });

        database.valorantCaptures.markConfirmed(id, lote.id, 'admin');
        draftStream.publish(id, 'competition_updated');

        response.json({
          batch: database.valorantCaptures.getBatch(id, lote.id),
          series,
          standings: database.valorantCompetition.standings(id, {
            teams: database.valorant.listTeams(id)
          })
        });
      } catch (error) { next(error); }
    });


  // ==================================================== eliminatorias

  /** Cómo va el cuadro y si se puede generar ya. */
  app.get('/api/admin/events/:id/playoffs', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const teams = database.valorant.listTeams(id);
      const existe = database.valorantPlayoffs.exists(id);
      response.json({
        generated: existe,
        grandFinalBestOf: database.valorantPlayoffs.grandFinalBestOf(id),
        // Mientras no exista, se dice si ya se puede y, si no, por qué no.
        readiness: existe ? null : database.valorantPlayoffs.seedsFromRegularSeason(id, teams),
        series: existe ? database.valorantPlayoffs.listSeries(id) : [],
        standings: existe ? database.valorantPlayoffs.standings(id) : null,
        teams
      });
    } catch (error) { next(error); }
  });

  /** A cuántos mapas se juega la gran final. Antes de empezar. */
  app.put('/api/admin/events/:id/playoffs/format', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const bestOf = database.valorantPlayoffs.setGrandFinalBestOf(id, request.body?.bestOf);
      draftStream.publish(id, 'competition_updated');
      response.json({ grandFinalBestOf: bestOf });
    } catch (error) { next(error); }
  });

  /**
   * Monta el cuadro.
   *
   * Los emparejamientos NO llegan del navegador: los deriva el servidor de la
   * clasificación. Y no se genera con la liga a medias ni con un empate que
   * afecte a los cuatro primeros, porque sembrar al azar decide quién entra.
   */
  app.post('/api/admin/events/:id/playoffs/generate', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const series = database.valorantPlayoffs.generate(id, database.valorant.listTeams(id));
      draftStream.publish(id, 'competition_updated');
      response.status(201).json({
        series, standings: database.valorantPlayoffs.standings(id)
      });
    } catch (error) { next(error); }
  });
  // ---------------------------------------------------- draft: administración
  app.get('/api/admin/events/:id/draft', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const event = database.getEventById(id);
      response.json({
        format: officialValorantFormatForSlug(event?.slug),
        draft: database.valorant.getDraft(id) ?? null,
        teams: database.valorant.listTeams(id),
        available: database.valorant.listAvailableParticipants(id)
      });
    } catch (error) { next(error); }
  });

  app.put('/api/admin/events/:id/draft', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const draft = database.valorant.configureDraft(id, {
        captains: request.body?.captains,
        teamCount: request.body?.teamCount,
        teamSize: request.body?.teamSize,
        actor: 'admin'
      });
      draftStream.publish(id, 'draft_configured');
      response.json({ draft, teams: database.valorant.listTeams(id) });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/draft/start', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const draft = database.valorant.startDraft(id);
      draftStream.publish(id, 'draft_started');
      response.json({ draft });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/draft/status', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const draft = database.valorant.setDraftStatus(id, request.body?.status, { reason: request.body?.reason });
      draftStream.publish(id, draft.status === 'PAUSED' ? 'draft_paused' : 'draft_resumed');
      response.json({ draft });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/teams/move', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const team = database.valorant.moveParticipant(id, {
        participantId: request.body?.participantId,
        toTeamId: request.body?.toTeamId,
        reason: request.body?.reason
      });
      draftStream.publish(id, 'team_updated');
      response.json({ team });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/events/:id/teams/captain', (request, response, next) => {
    const id = parseId(request.params.id);
    try {
      const team = database.valorant.changeCaptain(id, {
        teamId: request.body?.teamId,
        participantId: request.body?.participantId,
        reason: request.body?.reason
      });
      draftStream.publish(id, 'team_updated');
      response.json({ team });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/events/:id/audit', (request, response, next) => {
    const id = parseId(request.params.id);
    try { response.json({ audit: database.valorant.listAudit(id) }); }
    catch (error) { next(error); }
  });

  app.use('/api', (_request, response) => sendError(response, 404, 'API_NOT_FOUND', 'La ruta de API no existe.'));

  app.get('/informacion', (_request, response) => response.redirect(302, `/eventos/${database.getDefaultEvent().slug}/informacion`));
  app.get('/clasificacion', (_request, response) => response.redirect(302, `/eventos/${database.getDefaultEvent().slug}/competicion`));

  /*
    Las plantillas se leen una vez y se guardan en memoria: lo que cambia entre
    dos peticiones son los metadatos, no el fichero.
  */
  const plantillas = new Map();
  const leerPlantilla = (fichero) => {
    if (!plantillas.has(fichero)) {
      plantillas.set(fichero, fs.readFileSync(path.join(PUBLIC_DIRECTORY, fichero), 'utf8'));
    }
    return plantillas.get(fichero);
  };

  const origenPublico = (request) => {
    if (publicBaseUrl) return publicBaseUrl.replace(/\/+$/, '');
    const host = request.get('host');
    return host ? `${request.protocol}://${host}` : null;
  };

  /**
   * Envía una página con su título, su descripción y su tarjeta social ya
   * escritos. El evento se busca por el slug de la URL; si no existe, se
   * responde igual con los metadatos del sitio en vez de fallar: la página se
   * encarga después de decir que el evento no está.
   */
  const enviarPagina = (fichero, seccion = null) => (request, response) => {
    let evento = null;
    if (request.params?.slug) {
      try { evento = database.getEventBySlug(request.params.slug) ?? null; }
      catch { evento = null; }
    }
    const metadata = buildMetadata({
      event: evento, section: seccion,
      origin: origenPublico(request),
      path: request.originalUrl.split('?')[0]
    });
    response.type('html').send(injectMetadata(leerPlantilla(fichero), metadata));
  };

  app.get('/perfil', enviarPagina('profile.html'));
  const sendDraftPage = enviarPagina('draft.html', 'draft');
  const sendCompetitionPage = enviarPagina('competition-page.html', 'competicion');

  /*
    Cada juego tiene su portada de competición, pero las dos pasan por el mismo
    sitio para que la tarjeta social salga bien también ahí.
  */
  const sendCompetitionHome = (request, response) => {
    const event = database.getEventBySlug(request.params.slug);
    // Cada juego declara su portada de competición; el que no declare
    // ninguna usa la genérica.
    return enviarPagina(gameProfile(event?.game).competitionPage, 'competicion')(request, response);
  };
  app.get('/eventos/:slug/draft', sendDraftPage);
  app.get('/eventos/:slug/competicion/draft', sendDraftPage);
  app.get('/eventos/:slug/competicion/fase-regular/jornadas/:jornada', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/fase-regular/clasificacion', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/fase-regular/jornadas', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/fase-regular', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/playoffs', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/estadisticas', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/resultados', sendCompetitionPage);
  app.get('/eventos/:slug/competicion/partidos/:matchId', sendCompetitionPage);
  app.get('/eventos/:slug/competicion', sendCompetitionHome);
  app.get('/eventos/:slug/informacion', enviarPagina('informacion.html', 'informacion'));
  app.get('/eventos/:slug', enviarPagina('event.html'));
  app.get('/eventos/:slug/:section', enviarPagina('event.html'));
  app.get('/', enviarPagina('index.html'));

  /*
    El mapa del sitio se genera: los eventos aparecen y se archivan, y un
    fichero escrito a mano se queda desfasado a la primera.
  */
  app.get('/sitemap.xml', (request, response) => {
    const origen = origenPublico(request) || '';
    const enlaces = ['/', '/privacidad', '/terminos', '/contacto'];
    for (const evento of database.listEvents()) {
      enlaces.push(`/eventos/${encodeURIComponent(evento.slug)}`);
      if (evento.modules?.information) enlaces.push(`/eventos/${encodeURIComponent(evento.slug)}/informacion`);
      if (evento.modules?.competition) enlaces.push(`/eventos/${encodeURIComponent(evento.slug)}/competicion`);
      if (evento.modules?.draft) enlaces.push(`/eventos/${encodeURIComponent(evento.slug)}/competicion/draft`);
    }
    const cuerpo = enlaces
      .map((ruta) => `  <url><loc>${escapeXml(`${origen}${ruta}`)}</loc></url>`)
      .join('\n');
    response.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`);
  });

  app.get('/robots.txt', (request, response) => {
    const origen = origenPublico(request) || '';
    response.type('text/plain').send([
      '# Mini Eventos Jartiland',
      '',
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /api/',
      'Allow: /',
      '',
      `Sitemap: ${origen}/sitemap.xml`,
      ''
    ].join('\n'));
  });

  /*
    Las imágenes y las fuentes se pueden cachear de sobra; el HTML no, porque
    cambia con cada evento y una portada vieja en la caché del navegador es
    peor que una recarga.
  */
  app.use(express.static(PUBLIC_DIRECTORY, {
    extensions: ['html'],
    setHeaders(response, ruta) {
      response.setHeader('Cache-Control', /\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(ruta)
        ? 'public, max-age=604800'
        : 'no-cache');
    }
  }));
  app.use((_request, response) => {
    // Una página de error con la identidad del sitio y una salida. Un texto
    // plano deja al visitante sin saber siquiera dónde ha caído.
    //
    // Sin metadatos sociales a propósito: lleva su propio título, va marcada
    // como noindex y nadie comparte un enlace roto queriendo.
    response.status(404).type('html').send(leerPlantilla('404.html'));
  });


  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.parse.failed') return sendError(response, 400, 'INVALID_JSON', 'El cuerpo no contiene JSON valido.');
    if (error?.type === 'entity.too.large') return sendError(response, 413, 'REPORT_TOO_LARGE', 'El informe supera el limite de 1 MB.');
    if (error instanceof EventValidationError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof CompetitionError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof ReporterAuthError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof ValorantError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof ValorantCompetitionError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof CaptureError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof PlayoffError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof UploadError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof multer.MulterError) {
      const code = error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE'
        : error.code === 'LIMIT_FILE_COUNT' ? 'TOO_MANY_FILES' : 'UPLOAD_REJECTED';
      return sendError(response, 413, code, 'La subida no cumple los límites.');
    }
    if (error instanceof DiscordOAuthError) return sendError(response, error.status || 502, error.code, error.message);
    if (error instanceof InformationValidationError) return sendError(response, 400, 'INVALID_TOURNAMENT_INFORMATION', error.message);
    logger.error({ event: 'request_error', method: request.method, path: request.originalUrl, message: error?.message || String(error) });
    return sendError(response, 500, 'INTERNAL_ERROR', 'Error interno del servidor.');
  });
  app.locals.draftStream = draftStream;
  return app;
}

module.exports = { createApp };
