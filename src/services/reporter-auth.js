'use strict';

const crypto = require('node:crypto');

const REPORTER_TOKEN_PREFIX = 'jtr_';

class ReporterAuthError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ReporterAuthError';
    this.code = code;
    this.status = status;
  }
}

function generateReporterToken() {
  return `${REPORTER_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function hashReporterToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function readBearer(request) {
  const authorization = String(request.get('authorization') || '');
  const bearer = authorization.match(/^[ \t]*Bearer(?:[ \t]+(.*))?$/i);
  return bearer
    ? (bearer[1] || '').trim()
    : (request.get('x-reporter-token') || '').trim();
}

function timingSafeTokenEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function hostRequiredError() {
  return new ReporterAuthError(
    'Se requiere identificar el host Reporter.',
    'REPORTER_HOST_REQUIRED',
    400
  );
}

function disabledHostError() {
  return new ReporterAuthError(
    'El host Reporter no está habilitado.',
    'REPORTER_HOST_DISABLED',
    403
  );
}

function hostMismatchError() {
  return new ReporterAuthError(
    'La credencial Reporter no corresponde al host indicado.',
    'REPORTER_HOST_MISMATCH',
    403
  );
}

function normalizeHostId(hostId) {
  if (typeof hostId !== 'string') return hostId;
  const normalized = hostId.trim();
  if (!/^\d+$/.test(normalized)) return normalized;
  const numericId = Number(normalized);
  return Number.isSafeInteger(numericId) ? numericId : normalized;
}

function createReporterAuthorizer({ legacyToken, competition }) {
  if (typeof legacyToken === 'string' && legacyToken.startsWith(REPORTER_TOKEN_PREFIX)) {
    throw new ReporterAuthError(
      'REPORTER_TOKEN usa un prefijo reservado.',
      'REPORTER_LEGACY_TOKEN_RESERVED_PREFIX',
      500
    );
  }
  return {
    authorize({ eventId, hostId, suppliedToken, requireHost = false }) {
      if (typeof suppliedToken !== 'string' || !suppliedToken.trim()) {
        throw new ReporterAuthError(
          'Se requiere una credencial Reporter.',
          'REPORTER_TOKEN_REQUIRED',
          401
        );
      }
      const requestedHostId = normalizeHostId(hostId);
      const hasHostId = requestedHostId !== undefined
        && requestedHostId !== null
        && requestedHostId !== '';
      const host = suppliedToken.startsWith(REPORTER_TOKEN_PREFIX)
        ? competition.findHostByReporterTokenHash(eventId, hashReporterToken(suppliedToken))
        : null;
      if (host) {
        if (!hasHostId) throw hostRequiredError();
        if (!host.enabled) throw disabledHostError();
        if (host.id !== requestedHostId && host.identifier !== requestedHostId) {
          throw hostMismatchError();
        }
        return { host, authenticationKind: 'HOST_TOKEN' };
      }
      if (typeof legacyToken === 'string'
          && legacyToken.length > 0
          && timingSafeTokenEqual(suppliedToken, legacyToken)) {
        if (!hasHostId) {
          if (requireHost) throw hostRequiredError();
          return { host: null, authenticationKind: 'LEGACY_TOKEN' };
        }
        const legacyHost = competition.getHost(eventId, requestedHostId);
        if (!legacyHost) throw hostMismatchError();
        if (!legacyHost.enabled) throw disabledHostError();
        return { host: legacyHost, authenticationKind: 'LEGACY_TOKEN' };
      }
      throw new ReporterAuthError(
        'La credencial Reporter no es válida.',
        'REPORTER_TOKEN_INVALID',
        401
      );
    }
  };
}

module.exports = {
  REPORTER_TOKEN_PREFIX,
  ReporterAuthError,
  generateReporterToken,
  hashReporterToken,
  readBearer,
  createReporterAuthorizer
};
