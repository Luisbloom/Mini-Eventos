'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  REPORTER_TOKEN_PREFIX,
  generateReporterToken,
  hashReporterToken,
  readBearer,
  createReporterAuthorizer
} = require('../src/services/reporter-auth');

function fakeCompetition(...records) {
  function publicHost(record) {
    if (!record) return null;
    const { tokenHash, ...host } = record;
    return host;
  }

  return {
    getHost(eventId, hostId) {
      return publicHost(records.find((record) => (
        record.eventId === eventId
        && (record.id === hostId || record.identifier === hostId)
      )));
    },
    findHostByReporterTokenHash(eventId, tokenHash) {
      return publicHost(records.find((record) => (
        record.eventId === eventId && record.tokenHash === tokenHash
      )));
    }
  };
}

describe('Reporter authentication', () => {
  it('generates a 32-byte Base64URL token and hashes it as SHA-256 hex', () => {
    const token = generateReporterToken();

    assert.equal(REPORTER_TOKEN_PREFIX, 'jtr_');
    assert.match(token, /^jtr_[A-Za-z0-9_-]{43}$/);
    assert.match(hashReporterToken(token), /^[a-f0-9]{64}$/);
  });

  it('rejects a legacy token in the reserved per-host namespace at construction', () => {
    assert.throws(
      () => createReporterAuthorizer({
        legacyToken: 'jtr_reserved-for-hosts',
        competition: fakeCompetition()
      }),
      (error) => {
        assert.equal(error.status, 500);
        assert.equal(error.code, 'REPORTER_LEGACY_TOKEN_RESERVED_PREFIX');
        assert.equal(error.message, 'REPORTER_TOKEN usa un prefijo reservado.');
        assert.equal(error.message.includes('jtr_reserved-for-hosts'), false);
        return true;
      }
    );
  });

  it('reads and trims a Bearer credential from an Express request', () => {
    const request = {
      get(name) {
        return name === 'authorization' ? 'Bearer  reporter-secret  ' : undefined;
      }
    };

    assert.equal(readBearer(request), 'reporter-secret');
  });

  it('recognizes Bearer case-insensitively with reasonable HTTP whitespace', () => {
    const headers = {
      authorization: ' \t bEaReR\t  reporter-secret  \t',
      'x-reporter-token': 'fallback-must-not-win'
    };
    const request = { get: (name) => headers[name] };

    assert.equal(readBearer(request), 'reporter-secret');
  });

  it('falls back to x-reporter-token when no Bearer credential is present', () => {
    const headers = {
      authorization: 'Basic ignored',
      'x-reporter-token': '  fallback-secret  '
    };
    const request = { get: (name) => headers[name] };

    assert.equal(readBearer(request), 'fallback-secret');
  });

  it('does not fall back to x-reporter-token for an empty Bearer credential', () => {
    const headers = {
      authorization: 'BEARER \t ',
      'x-reporter-token': 'fallback-must-not-win'
    };
    const request = { get: (name) => headers[name] };

    assert.equal(readBearer(request), '');
  });

  it('binds a per-host token to its explicit event and host', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      legacyToken: 'legacy-secret',
      competition: fakeCompetition({
        id: 2,
        identifier: 'HOST_2',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    const authorized = auth.authorize({
      eventId: 1,
      hostId: 'HOST_2',
      suppliedToken: token
    });

    assert.equal(authorized.host.identifier, 'HOST_2');
    assert.equal(authorized.authenticationKind, 'HOST_TOKEN');
    assert.equal(JSON.stringify(authorized).includes(hashReporterToken(token)), false);
  });

  it('never authenticates an unprefixed credential as a per-host token', () => {
    const token = 'unprefixed-host-secret';
    const auth = createReporterAuthorizer({
      legacyToken: 'different-legacy-secret',
      competition: fakeCompetition({
        id: 2,
        identifier: 'HOST_2',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'HOST_2', suppliedToken: token }),
      (error) => error.status === 401 && error.code === 'REPORTER_TOKEN_INVALID'
    );
  });

  it('treats a decimal string hostId as the equivalent numeric host id', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 2,
        identifier: 'HOST_2',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    const authorized = auth.authorize({
      eventId: 1,
      hostId: '2',
      suppliedToken: token
    });

    assert.equal(authorized.host.id, 2);
    assert.equal(authorized.authenticationKind, 'HOST_TOKEN');
  });

  it('rejects a per-host credential immediately after it is revoked', () => {
    const token = generateReporterToken();
    const hostRecord = {
      id: 2,
      identifier: 'HOST_2',
      eventId: 1,
      enabled: true,
      tokenHash: hashReporterToken(token)
    };
    const auth = createReporterAuthorizer({
      legacyToken: 'different-legacy-secret',
      competition: fakeCompetition(hostRecord)
    });

    assert.equal(auth.authorize({
      eventId: 1,
      hostId: 'HOST_2',
      suppliedToken: token
    }).authenticationKind, 'HOST_TOKEN');

    hostRecord.tokenHash = null;
    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'HOST_2', suppliedToken: token }),
      (error) => error.status === 401 && error.code === 'REPORTER_TOKEN_INVALID'
    );
  });

  it('rejects using a valid token with a different explicit host', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 2,
        identifier: 'HOST_2',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'HOST_1', suppliedToken: token }),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'REPORTER_HOST_MISMATCH');
        assert.equal(error.message.includes(token), false);
        assert.equal(error.message.includes(hashReporterToken(token)), false);
        return true;
      }
    );
  });

  it('rejects a missing Reporter credential with a safe authentication error', () => {
    const auth = createReporterAuthorizer({ competition: fakeCompetition() });

    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'HOST_1', suppliedToken: '  ' }),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.code, 'REPORTER_TOKEN_REQUIRED');
        assert.equal(error.message, 'Se requiere una credencial Reporter.');
        return true;
      }
    );
  });

  it('requires an explicit host for a per-host credential', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 1,
        identifier: 'HOST_1',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 1, suppliedToken: token }),
      (error) => error.status === 400 && error.code === 'REPORTER_HOST_REQUIRED'
    );
  });

  it('rejects a disabled host even when its token is valid', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 1,
        identifier: 'HOST_1',
        eventId: 1,
        enabled: false,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'HOST_1', suppliedToken: token }),
      (error) => error.status === 403 && error.code === 'REPORTER_HOST_DISABLED'
    );
  });

  it('does not accept a host token for a different event', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 1,
        identifier: 'HOST_1',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 2, hostId: 'HOST_1', suppliedToken: token }),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.code, 'REPORTER_TOKEN_INVALID');
        assert.equal(error.message.includes('HOST_1'), false);
        assert.equal(error.message.includes('1'), false);
        return true;
      }
    );
  });

  it('authorizes the legacy token against a valid explicit host', () => {
    const auth = createReporterAuthorizer({
      legacyToken: 'legacy-secret',
      competition: fakeCompetition({
        id: 1,
        identifier: 'HOST_1',
        eventId: 1,
        enabled: true,
        tokenHash: null
      })
    });

    const authorized = auth.authorize({
      eventId: 1,
      hostId: 'HOST_1',
      suppliedToken: 'legacy-secret',
      requireHost: true
    });

    assert.equal(authorized.host.identifier, 'HOST_1');
    assert.equal(authorized.authenticationKind, 'LEGACY_TOKEN');
  });

  it('normalizes a decimal string hostId before resolving a legacy host', () => {
    const auth = createReporterAuthorizer({
      legacyToken: 'legacy-secret',
      competition: fakeCompetition({
        id: 2,
        identifier: 'HOST_2',
        eventId: 1,
        enabled: true,
        tokenHash: null
      })
    });

    const authorized = auth.authorize({
      eventId: 1,
      hostId: '2',
      suppliedToken: 'legacy-secret',
      requireHost: true
    });

    assert.equal(authorized.host.identifier, 'HOST_2');
    assert.equal(authorized.authenticationKind, 'LEGACY_TOKEN');
  });

  it('keeps the legacy token compatible with unstructured reports without a host', () => {
    const auth = createReporterAuthorizer({
      legacyToken: 'legacy-secret',
      competition: fakeCompetition()
    });

    assert.deepEqual(
      auth.authorize({ eventId: 1, suppliedToken: 'legacy-secret' }),
      { host: null, authenticationKind: 'LEGACY_TOKEN' }
    );
  });

  it('requires a host for a legacy credential in competitive context', () => {
    const auth = createReporterAuthorizer({
      legacyToken: 'legacy-secret',
      competition: fakeCompetition()
    });

    assert.throws(
      () => auth.authorize({
        eventId: 1,
        suppliedToken: 'legacy-secret',
        requireHost: true
      }),
      (error) => error.status === 400 && error.code === 'REPORTER_HOST_REQUIRED'
    );
  });

  it('rejects an unknown explicit host without revealing whether it exists', () => {
    const token = generateReporterToken();
    const auth = createReporterAuthorizer({
      competition: fakeCompetition({
        id: 1,
        identifier: 'HOST_1',
        eventId: 1,
        enabled: true,
        tokenHash: hashReporterToken(token)
      })
    });

    assert.throws(
      () => auth.authorize({ eventId: 1, hostId: 'UNKNOWN', suppliedToken: token }),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'REPORTER_HOST_MISMATCH');
        assert.equal(error.message.includes('UNKNOWN'), false);
        return true;
      }
    );
  });

  it('compares the legacy credential with timingSafeEqual', () => {
    const originalTimingSafeEqual = crypto.timingSafeEqual;
    let comparisons = 0;
    crypto.timingSafeEqual = (...args) => {
      comparisons += 1;
      return originalTimingSafeEqual(...args);
    };

    try {
      const auth = createReporterAuthorizer({
        legacyToken: 'legacy-secret',
        competition: fakeCompetition()
      });
      auth.authorize({ eventId: 1, suppliedToken: 'legacy-secret' });
    } finally {
      crypto.timingSafeEqual = originalTimingSafeEqual;
    }

    assert.equal(comparisons, 1);
  });
});
