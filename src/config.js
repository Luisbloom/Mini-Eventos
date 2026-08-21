'use strict';

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveFromRoot(value, projectRoot) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function parsePort(rawPort) {
  const value = rawPort ?? '3000';
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535');
  }

  return port;
}

function parseTrustProxy(rawValue) {
  if (rawValue === undefined || rawValue === '' || rawValue === 'false') {
    return false;
  }

  if (rawValue === 'true') {
    return true;
  }

  const hops = Number(rawValue);
  if (Number.isInteger(hops) && hops >= 0) {
    return hops;
  }

  throw new Error('TRUST_PROXY debe ser true, false o un numero entero');
}

function loadConfig(env = process.env, projectRoot = PROJECT_ROOT) {
  const dataDir = resolveFromRoot(env.DATA_DIR || 'data', projectRoot);
  const dbPath = resolveFromRoot(
    env.DB_PATH || path.join(dataDir, 'tournament.db'),
    projectRoot
  );
  const host = (env.HOST || '0.0.0.0').trim();

  if (!host) {
    throw new Error('HOST no puede estar vacio');
  }

  return Object.freeze({
    host,
    port: parsePort(env.PORT),
    dataDir,
    dbPath,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    adminToken: env.ADMIN_TOKEN?.trim() || null,
    reporterToken: env.REPORTER_TOKEN?.trim() || null,
    nodeEnv: env.NODE_ENV || 'development'
  });
}

module.exports = { loadConfig, PROJECT_ROOT };
