'use strict';

require('dotenv').config({ quiet: true });

const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { openDatabase } = require('./database');

const logger = {
  info(entry) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  },
  error(entry) {
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  }
};

let database;
let server;
let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: 'shutdown_started', signal });

  const forceExit = setTimeout(() => {
    logger.error({ event: 'shutdown_timeout' });
    process.exit(1);
  }, 15000);
  forceExit.unref();

  const finish = () => {
    try {
      database?.close();
    } finally {
      logger.info({ event: 'shutdown_complete' });
      process.exit(exitCode);
    }
  };

  if (server) {
    server.close(finish);
  } else {
    finish();
  }
}

try {
  const config = loadConfig();
  database = openDatabase(config.dbPath);
  const app = createApp({
    database,
    trustProxy: config.trustProxy,
    logger,
    adminToken: config.adminToken,
    reporterToken: config.reporterToken
  });

  server = app.listen(config.port, config.host, () => {
    logger.info({
      event: 'server_started',
      address: `http://${config.host}:${config.port}`,
      database: config.dbPath,
      environment: config.nodeEnv
    });
  });

  server.on('error', (error) => {
    logger.error({ event: 'server_error', code: error.code, message: error.message });
    shutdown('server_error', 1);
  });
} catch (error) {
  logger.error({ event: 'startup_error', message: error.message });
  database?.close();
  process.exit(1);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error({ event: 'uncaught_exception', message: error.message, stack: error.stack });
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', message: String(reason) });
  shutdown('unhandledRejection', 1);
});
