'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { buildLeaderboard } = require('./leaderboard');
const { getPublicScoringRules, SCORING_CONFIG } = require('./services/scoring');
const { InformationValidationError } = require('./tournament-information');
const { EventValidationError } = require('./events');
const { CompetitionError } = require('./competition');
const { createMatchIngestor } = require('./services/match-ingest');
const {
  createDiscordProvider, DiscordOAuthError,
  sessionCookie, clearedSessionCookie, readSessionCookie, safeReturnPath,
  oauthNonceCookie, clearedOAuthNonceCookie, readOAuthNonceCookie
} = require('./services/discord-oauth');
const { ValorantError } = require('./valorant-store');
const { createDraftStream } = require('./services/draft-stream');
const { createReporterContextResolver } = require('./services/reporter-context');
const {
  ReporterAuthError,
  createReporterAuthorizer,
  generateReporterToken,
  hashReporterToken,
  readBearer
} = require('./services/reporter-auth');

const PUBLIC_DIRECTORY = path.resolve(__dirname, '..', 'public');
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
  return event.game.toLocaleLowerCase('es') === 'among us' ? scoringPayload() : null;
}

function createApp({
  database,
  trustProxy = false,
  logger = console,
  adminToken = null,
  reporterToken = null,
  reporterPrivateUrl = null,
  discord = null,
  secureCookies = false
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
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
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
      response.set('Cache-Control', 'no-store').json({ event, registrationFields });
    } catch (error) { next(error); }
  });

  app.post('/api/events/:slug/registrations', (request, response, next) => {
    try {
      const event = eventFromSlug(request, response);
      if (!event) return;
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
        return { ...stage, groups, leaderboard };
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
        event,
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
   * Inscripción de Valorant. El cuerpo sólo trae lo que escribe la persona: la
   * cuenta sale de la cookie, así que nadie puede adjudicarse una inscripción
   * ajena mandando un id.
   */
  app.post('/api/events/:slug/valorant/registrations', (request, response, next) => {
    try {
      const event = draftEventFromSlug(request, response);
      if (!event) return;

      const session = currentSession(request);
      if (!session) {
        return sendError(response, 401, 'AUTH_REQUIRED', 'Entra con Discord para inscribirte.');
      }

      const registro = database.valorant.registerWithDiscord(event.id, {
        discordAccountId: session.account.id,
        riotId: request.body?.riotId,
        // Lo que el navegador diga sobre identidad se ignora por completo.
        values: {}
      }, (eventId, values) => database.createParticipant(eventId, values));

      response.status(201).json({ registration: registro });
    } catch (error) { next(error); }
  });

  // ---------------------------------------------------------------- draft
  app.get('/api/events/:slug/draft', (request, response, next) => {
    try {
      const event = draftEventFromSlug(request, response);
      if (!event) return;
      const state = database.valorant.publicDraftState(event.id);
      if (!state) return sendError(response, 404, 'DRAFT_NOT_FOUND', 'Este evento no tiene draft.');
      response.json(state);
    } catch (error) { next(error); }
  });

  app.get('/api/events/:slug/teams', (request, response, next) => {
    try {
      const event = draftEventFromSlug(request, response);
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
      const event = draftEventFromSlug(request, response);
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
    const event = draftEventFromSlug(request, response);
    if (!event) return;
    draftStream.attach(event.id, request, response);
  });

  // ---------------------------------------------------- draft: administración
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
  app.get('/clasificacion', (_request, response) => response.redirect(302, `/eventos/${database.getDefaultEvent().slug}#clasificacion`));
  app.get('/eventos/:slug/informacion', (_request, response) => response.sendFile(path.join(PUBLIC_DIRECTORY, 'informacion.html')));
  app.get('/eventos/:slug', (_request, response) => response.sendFile(path.join(PUBLIC_DIRECTORY, 'event.html')));
  app.get('/eventos/:slug/:section', (_request, response) => response.sendFile(path.join(PUBLIC_DIRECTORY, 'event.html')));
  app.use(express.static(PUBLIC_DIRECTORY, { extensions: ['html'] }));
  app.use((_request, response) => response.status(404).type('text').send('Pagina no encontrada'));


  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.parse.failed') return sendError(response, 400, 'INVALID_JSON', 'El cuerpo no contiene JSON valido.');
    if (error?.type === 'entity.too.large') return sendError(response, 413, 'REPORT_TOO_LARGE', 'El informe supera el limite de 1 MB.');
    if (error instanceof EventValidationError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof CompetitionError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof ReporterAuthError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof ValorantError) return sendError(response, error.status || 400, error.code, error.message);
    if (error instanceof DiscordOAuthError) return sendError(response, error.status || 502, error.code, error.message);
    if (error instanceof InformationValidationError) return sendError(response, 400, 'INVALID_TOURNAMENT_INFORMATION', error.message);
    logger.error({ event: 'request_error', method: request.method, path: request.originalUrl, message: error?.message || String(error) });
    return sendError(response, 500, 'INTERNAL_ERROR', 'Error interno del servidor.');
  });
  app.locals.draftStream = draftStream;
  return app;
}

module.exports = { createApp };
