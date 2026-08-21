'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require('../src/config');

describe('config', () => {
  const projectRoot = path.join(path.parse(process.cwd()).root, 'srv', 'app');

  it('uses LAN-safe and persistent defaults', () => {
    const config = loadConfig({}, projectRoot);

    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 3000);
    assert.equal(config.dataDir, path.join(projectRoot, 'data'));
    assert.equal(config.dbPath, path.join(projectRoot, 'data', 'tournament.db'));
    assert.equal(config.trustProxy, false);
    assert.equal(config.adminToken, null);
    assert.equal(config.reporterToken, null);
  });

  it('accepts explicit paths, port and proxy configuration', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '4321',
      DATA_DIR: 'state',
      DB_PATH: 'state/custom.db',
      TRUST_PROXY: 'true',
      ADMIN_TOKEN: '  un-secreto-largo  ',
      REPORTER_TOKEN: ' reporter-secreto '
    }, projectRoot);

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 4321);
    assert.equal(config.dataDir, path.join(projectRoot, 'state'));
    assert.equal(config.dbPath, path.join(projectRoot, 'state', 'custom.db'));
    assert.equal(config.trustProxy, true);
    assert.equal(config.adminToken, 'un-secreto-largo');
    assert.equal(config.reporterToken, 'reporter-secreto');
  });

  for (const invalidPort of ['abc', '0', '65536', '3000.5']) {
    it(`rejects invalid PORT=${invalidPort}`, () => {
      assert.throws(
        () => loadConfig({ PORT: invalidPort }, projectRoot),
        /PORT debe ser un entero entre 1 y 65535/
      );
    });
  }

  it('rejects an unsupported TRUST_PROXY value', () => {
    assert.throws(
      () => loadConfig({ TRUST_PROXY: 'sometimes' }, projectRoot),
      /TRUST_PROXY debe ser true, false o un numero entero/
    );
  });
});
