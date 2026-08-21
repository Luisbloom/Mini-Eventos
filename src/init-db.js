'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { openDatabase } = require('./database');

try {
  const config = loadConfig();
  const database = openDatabase(config.dbPath);
  database.close();
  process.stdout.write(`Base de datos inicializada: ${config.dbPath}\n`);
} catch (error) {
  process.stderr.write(`No se pudo inicializar la base de datos: ${error.message}\n`);
  process.exitCode = 1;
}
