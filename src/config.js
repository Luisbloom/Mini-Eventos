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

/**
 * Origen con el que se construyen los enlaces de las tarjetas sociales.
 *
 * Se puede deducir de la petición, pero detrás de un proxy eso depende de que
 * las cabeceras lleguen bien. Configurarlo quita esa incertidumbre justo en lo
 * que se ve fuera: la previsualización de un enlace compartido.
 */
function parsePublicBaseUrl(rawValue) {
  const value = rawValue?.trim();
  if (!value) return null;
  let url;
  try { url = new URL(value); }
  catch { throw new Error('PUBLIC_BASE_URL debe ser una URL válida'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PUBLIC_BASE_URL debe ser HTTP o HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('PUBLIC_BASE_URL no debe llevar credenciales');
  }
  return url.origin;
}

function parseReporterPrivateUrl(rawValue) {
  const value = rawValue?.trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REPORTER_PRIVATE_URL debe ser una URL HTTPS válida');
  }
  if (url.protocol !== 'https:') {
    throw new Error('REPORTER_PRIVATE_URL debe ser una URL HTTPS válida');
  }
  if (url.username || url.password) {
    throw new Error('REPORTER_PRIVATE_URL debe ser una URL HTTPS válida sin credenciales');
  }
  return url.origin;
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
    discord: {
      clientId: env.DISCORD_CLIENT_ID?.trim() || null,
      clientSecret: env.DISCORD_CLIENT_SECRET?.trim() || null,
      redirectUri: env.DISCORD_REDIRECT_URI?.trim() || null
    },
    reporterToken: env.REPORTER_TOKEN?.trim() || null,
    reporterPrivateUrl: parseReporterPrivateUrl(env.REPORTER_PRIVATE_URL),
    publicBaseUrl: parsePublicBaseUrl(env.PUBLIC_BASE_URL),
    nodeEnv: env.NODE_ENV || 'development'
  });
}

module.exports = { loadConfig, PROJECT_ROOT };
