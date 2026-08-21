'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { buildLeaderboard } = require('./leaderboard');
const { getPublicScoringRules, SCORING_CONFIG } = require('./services/scoring');
const { InformationValidationError } = require('./tournament-information');

const PUBLIC_DIRECTORY = path.resolve(__dirname, '..', 'public');
const MAX_MATCHES_PER_PAGE = 100;

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } });
}

function isReport(body) {
  return body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length > 0;
}

function parseLimit(rawLimit) {
  if (rawLimit === undefined) {
    return 50;
  }

  if (!/^\d+$/.test(String(rawLimit))) {
    return null;
  }

  const value = Number(rawLimit);
  if (value < 1) {
    return null;
  }

  return Math.min(value, MAX_MATCHES_PER_PAGE);
}

function tokensMatch(supplied, expected) {
  const suppliedBuffer = Buffer.from(supplied || '');
  const expectedBuffer = Buffer.from(expected || '');
  return suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function createApp({ database, trustProxy = false, logger = console, adminToken = null }) {
  if (!database) {
    throw new TypeError('createApp necesita una base de datos');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet());

  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      logger.info({
        event: 'http_request',
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        remoteAddress: request.ip
      });
    });
    next();
  });

  app.use(express.json({ limit: '1mb', strict: true }));

  app.get('/api/health', (_request, response, next) => {
    try {
      response.json({
        status: 'ok',
        database: database.ping() ? 'ok' : 'error',
        uptimeSeconds: Math.round(process.uptime())
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/tournament-information', (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store').json({
        ...database.getTournamentInformation(),
        scoring: {
          config: SCORING_CONFIG,
          rules: getPublicScoringRules()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/admin/tournament-information', (request, response, next) => {
    if (!adminToken) {
      return sendError(
        response,
        503,
        'ADMIN_NOT_CONFIGURED',
        'Configura ADMIN_TOKEN en el servidor antes de editar.'
      );
    }

    const authorization = request.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!tokensMatch(suppliedToken, adminToken)) {
      return sendError(response, 401, 'ADMIN_UNAUTHORIZED', 'Token de administración incorrecto.');
    }

    try {
      if (!request.body?.information) {
        throw new InformationValidationError('Falta information.');
      }
      response.set('Cache-Control', 'no-store').json(
        database.updateTournamentInformation(request.body.information)
      );
    } catch (error) {
      if (error instanceof InformationValidationError) {
        return sendError(response, 400, 'INVALID_TOURNAMENT_INFORMATION', error.message);
      }
      next(error);
    }
  });

  app.post('/api/matches', (request, response, next) => {
    if (!isReport(request.body)) {
      return sendError(
        response,
        400,
        'INVALID_REPORT',
        'El cuerpo debe ser un objeto JSON no vacio.'
      );
    }

    try {
      const match = database.insertMatch(request.body, request.ip);
      response.location(`/api/matches/${match.id}`).status(201).json(match);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/matches', (request, response, next) => {
    const limit = parseLimit(request.query.limit);
    if (limit === null) {
      return sendError(
        response,
        400,
        'INVALID_LIMIT',
        'limit debe ser un entero mayor que cero.'
      );
    }

    try {
      response.json({
        matches: database.listMatches(limit),
        count: database.countMatches(),
        limit
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/leaderboard', (_request, response, next) => {
    try {
      response.json(buildLeaderboard(database.listAllMatches()));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/matches/:id', (request, response, next) => {
    if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
      return sendError(response, 400, 'INVALID_MATCH_ID', 'El id de partida no es valido.');
    }

    try {
      const match = database.getMatch(Number(request.params.id));
      if (!match) {
        return sendError(response, 404, 'MATCH_NOT_FOUND', 'No existe esa partida.');
      }
      response.json(match);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_request, response) => {
    sendError(response, 404, 'API_NOT_FOUND', 'La ruta de API no existe.');
  });

  app.use(express.static(PUBLIC_DIRECTORY, { extensions: ['html'] }));

  app.use((_request, response) => {
    response.status(404).type('text').send('Pagina no encontrada');
  });

  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.parse.failed') {
      return sendError(response, 400, 'INVALID_JSON', 'El cuerpo no contiene JSON valido.');
    }

    if (error?.type === 'entity.too.large') {
      return sendError(response, 413, 'REPORT_TOO_LARGE', 'El informe supera el limite de 1 MB.');
    }

    logger.error({
      event: 'request_error',
      method: request.method,
      path: request.originalUrl,
      message: error?.message || String(error)
    });
    return sendError(response, 500, 'INTERNAL_ERROR', 'Error interno del servidor.');
  });

  return app;
}

module.exports = { createApp };
