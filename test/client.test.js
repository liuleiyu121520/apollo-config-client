'use strict';

/**
 * Client behavior tests against the local mock Apollo server
 * (PRD AC-3-mock / AC-4 / AC-5a / AC-7 / AC-8 / AC-9, PLAN §7.3).
 *
 * Covers: 200 (both wire shapes), 304 semantics, 401 with exactly one
 * request (zero retries), 404, timeout, connection refused, invalid
 * JSON, unsigned mode, signature-verification end-to-end (right and
 * wrong secret), URL construction per the MINOR-001 clarification
 * (skipCache query order releaseKey -> dataCenter -> ip, fromCache only
 * ip, only defined values, fixed order), multi-namespace merge,
 * percent-encoding boundaries and the secret-leak regression.
 *
 * v1.1 (PLAN §7.3 thirty-four-row table): the 7 URL-exact tests without
 * a clientIp now pin `autoDetectIp: false` and keep their v1.0 URLs
 * byte-for-byte (regression group); the 2 default-semantics tests are
 * rewritten to assert that the default carries the auto-detected local
 * IP (stubbed `os.networkInterfaces`, fixed table: eth0 192.0.2.10) and
 * that `autoDetectIp: false` restores the no-ip behavior; one new test
 * covers the configServerUrl/metaServerUrl mutual exclusion (both throw,
 * neither keeps the v1.0 message, OpenApi entry exempt). The other 27
 * tests are zero-change (explicit clientIp x3 + non-URL assertions x24).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  remoteConfigServiceSkipCache,
  remoteConfigServiceFromCache,
  queryConfig,
  remoteConfigService,
  ApolloUnauthorizedError,
  ApolloHttpError,
  ApolloNetworkError,
  ApolloError,
} = require('../dist/index.js');

const { createApolloMockServer, stubNetworkInterfaces } = require('./helpers/mock-server.js');

const APP_ID = 'sample-app';
const CLUSTER = 'default';
const QA_CANARY_SECRET = 'TOPSECRET-QA-CANARY';

const ENV_KEYS = ['APOLLO_ACCESSKEY_SECRET', 'APOLLO_ACCESS_KEY_SECRET', 'APOLLO_ENV'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remove the secret-related env vars for the duration of `fn`. */
async function withoutSecretEnv(fn) {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      }
    }
  }
}

/** Base config pointing at the mock; unsigned (no secret) by default. */
function baseConfig(mock, extra) {
  return Object.assign(
    {
      configServerUrl: mock.baseURL,
      appId: APP_ID,
      clusterName: CLUSTER,
      namespaceName: 'application',
    },
    extra
  );
}

test('v1.1 client Meta discovery honors discoveryRefreshMs on repeated public calls', async () => {
  await withoutSecretEnv(async () => {
    const meta = await createApolloMockServer();
    const configA = await createApolloMockServer();
    const configB = await createApolloMockServer();
    try {
      meta.setServiceSequence([
        JSON.stringify([{ homepageUrl: configA.baseURL }]),
        JSON.stringify([{ homepageUrl: configB.baseURL }]),
      ]);

      const options = {
        metaServerUrl: meta.baseURL,
        appId: APP_ID,
        clusterName: CLUSTER,
        namespaceName: 'application',
        autoDetectIp: false,
        discoveryRefreshMs: 20,
      };
      await remoteConfigServiceSkipCache(options);
      await sleep(60);
      await remoteConfigServiceSkipCache(options);

      assert.strictEqual(meta.requestsTo('/services/config').length, 2);
      assert.strictEqual(configA.requestsTo('/configs/').length, 1);
      assert.strictEqual(configB.requestsTo('/configs/').length, 1);
    } finally {
      await configA.close();
      await configB.close();
      await meta.close();
    }
  });
});

test('v1.1 client Meta discovery honors timeoutMs and reports ApolloNetworkError', async () => {
  await withoutSecretEnv(async () => {
    const meta = await createApolloMockServer();
    meta.setBehavior((record) => {
      if (record.url.startsWith('/services/config')) {
        return {
          status: 200,
          delayMs: 100,
          body: JSON.stringify([{ homepageUrl: meta.baseURL }]),
        };
      }
      return null;
    });
    try {
      await assert.rejects(
        remoteConfigServiceSkipCache({
          metaServerUrl: meta.baseURL,
          appId: APP_ID,
          clusterName: CLUSTER,
          namespaceName: 'application',
          autoDetectIp: false,
          timeoutMs: 10,
        }),
        (err) => {
          assert.ok(err instanceof ApolloNetworkError);
          assert.match(err.url, /\/services\/config/);
          return true;
        }
      );
    } finally {
      await meta.close();
    }
  });
});

test('skipCache: 200 ApolloConfig shape, flat merge, signature headers present (AC-8)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceSkipCache(
        // §7.3 #1 regression group: no clientIp + exact-URL assertion ->
        // pin autoDetectIp:false, URL stays byte-for-byte the v1.0 one.
        baseConfig(mock, { namespaceName: 'application', secret: 'explicit-secret', autoDetectIp: false })
      );
      assert.deepStrictEqual(result, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      const [req] = mock.requestsTo('/configs/sample-app/default/application');
      assert.ok(req, 'expected one /configs request');
      assert.strictEqual(req.url, '/configs/sample-app/default/application');
      assert.match(req.headers.authorization, new RegExp(`^Apollo ${APP_ID}:[A-Za-z0-9+/=]+$`));
      assert.match(req.headers.timestamp, /^\d{13}$/);
      assert.strictEqual(req.headers['content-type'], 'application/json;charset=UTF-8');
    } finally {
      await mock.close();
    }
  });
});

test('fromCache: 200 flat shape via /configfiles/json with signature headers (AC-8)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceFromCache(
        baseConfig(mock, { namespaceName: 'application', secret: 'explicit-secret' })
      );
      assert.deepStrictEqual(result, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      const [req] = mock.requestsTo('/configfiles/json/sample-app/default/application');
      assert.ok(req, 'expected one /configfiles/json request');
      assert.match(req.headers.authorization, new RegExp(`^Apollo ${APP_ID}:`));
      assert.match(req.headers.timestamp, /^\d{13}$/);
    } finally {
      await mock.close();
    }
  });
});

test('multi-namespace array: concurrent requests, later namespace overrides (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceSkipCache(
        baseConfig(mock, { namespaceName: ['ns1', 'ns2'], secret: 'explicit-secret' })
      );
      assert.deepStrictEqual(result, {
        'ns1.k1': 'ns1-v1',
        'ns2.k1': 'ns2-v1',
        shared: 'ns2', // n1 的配置会被 n2 配置覆盖
      });
      assert.strictEqual(mock.requestsTo('/configs/').length, 2);
    } finally {
      await mock.close();
    }
  });
});

test('fromCache multi-namespace merge has the same override order (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceFromCache(
        baseConfig(mock, { namespaceName: ['ns1', 'ns2'], secret: 'explicit-secret' })
      );
      assert.deepStrictEqual(result, {
        'ns1.k1': 'ns1-v1',
        'ns2.k1': 'ns2-v1',
        shared: 'ns2',
      });
    } finally {
      await mock.close();
    }
  });
});

test('multi-namespace merge keeps JSON special keys as own data properties', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const bodyFor = (winner) =>
      `{"configurations":{"__proto__":{"winner":"${winner}"},"constructor":"${winner}",` +
      `"toString":"${winner}","shared":"${winner}"}}`;
    try {
      mock.setBehavior((record) => ({
        status: 200,
        body: bodyFor(record.url.includes('/ns2') ? 'ns2' : 'ns1'),
      }));
      const options = baseConfig(mock, {
        namespaceName: ['ns1', 'ns2'],
        autoDetectIp: false,
      });

      for (const entryPoint of [remoteConfigServiceSkipCache, remoteConfigServiceFromCache]) {
        const result = await entryPoint(options);
        assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
        assert.deepStrictEqual(Object.keys(result).sort(), [
          '__proto__',
          'constructor',
          'shared',
          'toString',
        ].sort());
        assert.deepStrictEqual(result['__proto__'], { winner: 'ns2' });
        assert.strictEqual(result.constructor, 'ns2');
        assert.strictEqual(result.toString, 'ns2');
        assert.strictEqual(result.shared, 'ns2');
      }
    } finally {
      await mock.close();
    }
  });
});

test('single string namespace works (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceSkipCache(baseConfig(mock));
      assert.deepStrictEqual(result, { 'application.k1': 'application-v1', shared: 'application' });
      assert.strictEqual(mock.requestsTo('/configs/').length, 1);
    } finally {
      await mock.close();
    }
  });
});

test('empty namespace array falls back to application (base behavior kept)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceSkipCache(baseConfig(mock, { namespaceName: [] }));
      assert.deepStrictEqual(result, { 'application.k1': 'application-v1', shared: 'application' });
      assert.strictEqual(mock.requestsTo('/configs/sample-app/default/application').length, 1);
    } finally {
      await mock.close();
    }
  });
});

test('payload without `configurations` falls back to merging the whole body', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 200, body: JSON.stringify({ flatKey: 'flat-value' }) }));
      const result = await remoteConfigServiceSkipCache(baseConfig(mock));
      assert.deepStrictEqual(result, { flatKey: 'flat-value' });
    } finally {
      await mock.close();
    }
  });
});

// ---------------------------------------------------------------------------
// URL / query construction (MINOR-001 clarification).
// ---------------------------------------------------------------------------

test('skipCache query: full args use the fixed order releaseKey -> dataCenter -> ip (MINOR-001)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      await remoteConfigServiceSkipCache(
        baseConfig(mock, { releaseKey: 'rk-1', dataCenter: 'dc-1', clientIp: '10.0.0.1' })
      );
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(
        req.url,
        '/configs/sample-app/default/application?releaseKey=rk-1&dataCenter=dc-1&ip=10.0.0.1'
      );
    } finally {
      await mock.close();
    }
  });
});

test('skipCache query: only releaseKey -> single pair (MINOR-001)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      // §7.3 #9 regression group: pin autoDetectIp:false for the exact URL.
      await remoteConfigServiceSkipCache(baseConfig(mock, { releaseKey: 'rk-1', autoDetectIp: false }));
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.url, '/configs/sample-app/default/application?releaseKey=rk-1');
    } finally {
      await mock.close();
    }
  });
});

test('skipCache query: only clientIp -> only ip (MINOR-001)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      await remoteConfigServiceSkipCache(baseConfig(mock, { clientIp: '10.0.0.1' }));
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.url, '/configs/sample-app/default/application?ip=10.0.0.1');
    } finally {
      await mock.close();
    }
  });
});

test('skipCache query: only dataCenter -> only dataCenter (MINOR-001)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      // §7.3 #11 regression group: pin autoDetectIp:false for the exact URL.
      await remoteConfigServiceSkipCache(baseConfig(mock, { dataCenter: 'dc-1', autoDetectIp: false }));
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.url, '/configs/sample-app/default/application?dataCenter=dc-1');
    } finally {
      await mock.close();
    }
  });
});

test('skipCache query: default carries the auto-detected ip; autoDetectIp:false restores no query', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const restore = stubNetworkInterfaces(); // fixed table: eth0 192.0.2.10
    try {
      // §7.3 #12 default-semantics group, arm 1: no clientIp + default
      // autoDetectIp -> the detected local IPv4 IS carried (deterministic
      // through the stubbed interface table).
      await remoteConfigServiceSkipCache(baseConfig(mock));
      const [defaulted] = mock.requestsTo('/configs/');
      assert.strictEqual(
        defaulted.url,
        '/configs/sample-app/default/application?ip=192.0.2.10'
      );
      assert.ok(!defaulted.url.includes('undefined'), 'no undefined fragments expected');
      // Arm 2: `autoDetectIp:false` restores the v1.0 behavior (no ip at
      // all, no query, no undefined fragments).
      await remoteConfigServiceSkipCache(baseConfig(mock, { autoDetectIp: false }));
      const [, pinned] = mock.requestsTo('/configs/');
      assert.strictEqual(pinned.url, '/configs/sample-app/default/application');
      assert.ok(!pinned.url.includes('undefined'));
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('fromCache query: only ip, releaseKey/dataCenter are never appended (MINOR-001)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      await remoteConfigServiceFromCache(
        baseConfig(mock, { releaseKey: 'rk-1', dataCenter: 'dc-1', clientIp: '10.0.0.1' })
      );
      const [req] = mock.requestsTo('/configfiles/json/');
      assert.strictEqual(req.url, '/configfiles/json/sample-app/default/application?ip=10.0.0.1');
    } finally {
      await mock.close();
    }
  });
});

test('fromCache query: default carries the auto-detected ip; autoDetectIp:false restores no query', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const restore = stubNetworkInterfaces(); // fixed table: eth0 192.0.2.10
    try {
      // §7.3 #14 default-semantics group, arm 1: releaseKey/dataCenter are
      // never appended to /configfiles/json; the default ip IS carried.
      await remoteConfigServiceFromCache(baseConfig(mock, { releaseKey: 'rk-1' }));
      const [defaulted] = mock.requestsTo('/configfiles/json/');
      assert.strictEqual(
        defaulted.url,
        '/configfiles/json/sample-app/default/application?ip=192.0.2.10'
      );
      // Arm 2: `autoDetectIp:false` restores the v1.0 no-query behavior.
      await remoteConfigServiceFromCache(
        baseConfig(mock, { releaseKey: 'rk-1', autoDetectIp: false })
      );
      const [, pinned] = mock.requestsTo('/configfiles/json/');
      assert.strictEqual(pinned.url, '/configfiles/json/sample-app/default/application');
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('query values are percent-encoded (releaseKey with space)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      // §7.3 #15 regression group: pin autoDetectIp:false for the exact URL.
      await remoteConfigServiceSkipCache(
        baseConfig(mock, { releaseKey: 'r k&x=1', autoDetectIp: false })
      );
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(
        req.url,
        '/configs/sample-app/default/application?releaseKey=r%20k%26x%3D1'
      );
    } finally {
      await mock.close();
    }
  });
});

test('trailing slash on configServerUrl is normalized', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      // §7.3 #16 regression group: pin autoDetectIp:false for the exact URL.
      await remoteConfigServiceSkipCache(
        baseConfig(mock, { configServerUrl: `${mock.baseURL}/`, autoDetectIp: false })
      );
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.url, '/configs/sample-app/default/application');
    } finally {
      await mock.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 304 semantics (AC-9).
// ---------------------------------------------------------------------------

test('skipCache: all 304 -> resolves null, not an error (AC-9)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 304, body: '' }));
      const result = await remoteConfigServiceSkipCache(baseConfig(mock, { releaseKey: 'rk' }));
      assert.strictEqual(result, null);
    } finally {
      await mock.close();
    }
  });
});

test('fromCache: all 304 -> resolves null (AC-9)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 304, body: '' }));
      const result = await remoteConfigServiceFromCache(baseConfig(mock, { releaseKey: 'rk' }));
      assert.strictEqual(result, null);
    } finally {
      await mock.close();
    }
  });
});

test('queryConfig: 304 -> { notModified: true } (AC-9)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 304, body: '' }));
      const result = await queryConfig(
        baseConfig(mock, { namespaceName: 'application', releaseKey: 'rk' })
      );
      assert.deepStrictEqual(result, { notModified: true });
    } finally {
      await mock.close();
    }
  });
});

test('queryConfig: 200 -> returns the ApolloConfig payload', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await queryConfig(baseConfig(mock, { namespaceName: 'application' }));
      assert.strictEqual(result.appId, APP_ID);
      assert.strictEqual(result.cluster, CLUSTER);
      assert.deepStrictEqual(result.configurations, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
    } finally {
      await mock.close();
    }
  });
});

test('mixed 304 + 200: only 200 payloads are merged (PLAN §7.3)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior((record) => {
        if (record.url.includes('/ns1')) {
          return { status: 304, body: '' };
        }
        return null; // ns2 falls back to the default 200
      });
      const result = await remoteConfigServiceSkipCache(
        baseConfig(mock, { namespaceName: ['ns1', 'ns2'] })
      );
      assert.deepStrictEqual(result, { 'ns2.k1': 'ns2-v1', shared: 'ns2' });
    } finally {
      await mock.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 401 (AC-4) and signature verification end-to-end (AC-3 mock / AC-5a).
// ---------------------------------------------------------------------------

test('401: ApolloUnauthorizedError with the three-way hint and exactly 1 request (zero retries)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 401, body: '' }));
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock, { secret: QA_CANARY_SECRET })),
        (err) => {
          assert.ok(err instanceof ApolloUnauthorizedError);
          assert.ok(err instanceof ApolloError);
          assert.strictEqual(err.statusCode, 401);
          assert.strictEqual(err.appId, APP_ID);
          assert.ok(err.message.includes('401'));
          assert.ok(err.message.includes('APOLLO_ACCESSKEY_SECRET'));
          assert.ok(err.message.includes('APOLLO_ACCESS_KEY_SECRET'));
          assert.ok(err.message.includes('properties'));
          assert.ok(err.message.includes('NTP'));
          assert.ok(err.url.includes('/configs/sample-app'), 'error carries the request URL');
          return true;
        }
      );
      assert.strictEqual(mock.requestsTo('/configs/').length, 1, 'must not retry');
    } finally {
      await mock.close();
    }
  });
});

test('signature verification mode: correct secret passes E2E (AC-3 mock, AC-5a)', async () => {
  await withoutSecretEnv(async () => {
    const secret = 'verify-me-1234567890';
    const mock = await createApolloMockServer({ verifySecret: secret });
    try {
      const result = await remoteConfigServiceSkipCache(baseConfig(mock, { secret }));
      assert.deepStrictEqual(result, { 'application.k1': 'application-v1', shared: 'application' });
    } finally {
      await mock.close();
    }
  });
});

test('signature verification mode: wrong secret -> 401 -> ApolloUnauthorizedError', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer({ verifySecret: 'the-real-secret' });
    try {
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock, { secret: 'a-wrong-secret' })),
        ApolloUnauthorizedError
      );
      assert.strictEqual(mock.requestsTo('/configs/').length, 1);
    } finally {
      await mock.close();
    }
  });
});

test('signature verification mode: unsigned request with accesskey enforced -> 401', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer({
      verifySecret: 'the-real-secret',
      requireSignature: true,
    });
    try {
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock, { propertiesPath: '/nonexistent/no.properties' })),
        ApolloUnauthorizedError
      );
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.headers.authorization, undefined);
      assert.strictEqual(req.headers.timestamp, undefined);
    } finally {
      await mock.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Other failure modes (FR-4 / PLAN §7.3).
// ---------------------------------------------------------------------------

test('404: ApolloHttpError with the "not published" hint', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 404, body: '' }));
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock)),
        (err) => {
          assert.ok(err instanceof ApolloHttpError);
          assert.strictEqual(err.statusCode, 404);
          assert.ok(err.message.includes('may not be published'));
          assert.ok(err.url.includes('/configs/sample-app'), 'error carries the request URL');
          return true;
        }
      );
    } finally {
      await mock.close();
    }
  });
});

test('generic 500: ApolloHttpError carrying the status code and URL', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 500, body: 'boom' }));
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock)),
        (err) => {
          assert.ok(err instanceof ApolloHttpError);
          assert.strictEqual(err.statusCode, 500);
          assert.ok(err.message.includes('500'));
          return true;
        }
      );
    } finally {
      await mock.close();
    }
  });
});

test('timeout: ApolloNetworkError with the URL (FR-4, no hang)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 200, body: '{}', delayMs: 1000 }));
      const startedAt = Date.now();
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock, { timeoutMs: 200 })),
        (err) => {
          assert.ok(err instanceof ApolloNetworkError);
          assert.ok(err.message.includes('timed out'));
          assert.ok(err.url.includes('/configs/sample-app'), 'error carries the request URL');
          return true;
        }
      );
      assert.ok(Date.now() - startedAt < 900, 'must fail at ~200ms, not wait the server');
    } finally {
      await mock.close();
    }
  });
});

test('connection refused: ApolloNetworkError', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const { port } = mock;
    await mock.close(); // nothing listens anymore
    await assert.rejects(
      remoteConfigServiceSkipCache(baseConfig(mock)),
      (err) => {
        assert.ok(err instanceof ApolloNetworkError);
        assert.ok(err.url.includes(String(port)));
        return true;
      }
    );
  });
});

test('invalid JSON body: ApolloHttpError (PLAN §5.2)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      mock.setBehavior(() => ({ status: 200, body: 'this is not json' }));
      await assert.rejects(
        remoteConfigServiceSkipCache(baseConfig(mock)),
        (err) => {
          assert.ok(err instanceof ApolloHttpError);
          assert.ok(err.message.includes('invalid JSON'));
          return true;
        }
      );
    } finally {
      await mock.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Unsigned mode and leak regression.
// ---------------------------------------------------------------------------

test('unsigned mode: no secret -> no Authorization/Timestamp headers, plain 200 works', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const result = await remoteConfigServiceSkipCache(
        baseConfig(mock, { propertiesPath: '/nonexistent/no.properties' })
      );
      assert.deepStrictEqual(result, { 'application.k1': 'application-v1', shared: 'application' });
      const [req] = mock.requestsTo('/configs/');
      assert.strictEqual(req.headers.authorization, undefined);
      assert.strictEqual(req.headers.timestamp, undefined);
    } finally {
      await mock.close();
    }
  });
});

test('leak regression: error objects never contain the secret (401 / 404 / timeout)', async () => {
  await withoutSecretEnv(async () => {
    const scenarios = [
      { status: 401, body: '' },
      { status: 404, body: '' },
      { status: 200, body: '{}', delayMs: 1000 },
    ];
    for (const behavior of scenarios) {
      const mock = await createApolloMockServer();
      try {
        mock.setBehavior(() => behavior);
        await assert.rejects(
          remoteConfigServiceSkipCache(baseConfig(mock, { secret: QA_CANARY_SECRET, timeoutMs: 200 })),
          (err) => {
            assert.ok(!String(err.message).includes(QA_CANARY_SECRET), 'message leaks secret');
            assert.ok(
              !JSON.stringify(err).includes(QA_CANARY_SECRET),
              'serialized error leaks secret'
            );
            return true;
          }
        );
      } finally {
        await mock.close();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Parameter validation and encoding boundaries.
// ---------------------------------------------------------------------------

test('missing required params raise ApolloError with base-style messages', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      await assert.rejects(remoteConfigServiceSkipCache(null), ApolloError);
      await assert.rejects(
        remoteConfigServiceSkipCache({ configServerUrl: mock.baseURL }),
        /appId is required/
      );
      await assert.rejects(
        remoteConfigServiceSkipCache({ configServerUrl: mock.baseURL, appId: 'a' }),
        /clusterName is required/
      );
      await assert.rejects(
        remoteConfigServiceSkipCache({ configServerUrl: mock.baseURL, appId: 'a', clusterName: 'c' }),
        /namespaceName is required/
      );
      assert.strictEqual(mock.requests.length, 0, 'no request should be made');
    } finally {
      await mock.close();
    }
  });
});

test('v1.1 mutual exclusion: both addresses throw, neither keeps the v1.0 message, OpenApi exempt', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      // Both configured -> ApolloError with the exact plan §5.4 message,
      // for every validating entry point (skipCache / fromCache /
      // queryConfig), with zero requests issued.
      const both = {
        configServerUrl: mock.baseURL,
        metaServerUrl: mock.baseURL,
        appId: APP_ID,
        clusterName: CLUSTER,
        namespaceName: 'application',
      };
      await assert.rejects(
        remoteConfigServiceSkipCache(both),
        (err) => {
          assert.ok(err instanceof ApolloError);
          assert.strictEqual(
            err.message,
            'configServerUrl and metaServerUrl are mutually exclusive, configure exactly one'
          );
          return true;
        }
      );
      await assert.rejects(remoteConfigServiceFromCache(both), /mutually exclusive/);
      await assert.rejects(queryConfig(both), /mutually exclusive/);
      assert.strictEqual(mock.requests.length, 0, 'no request should be made');
      // Neither configured -> the v1.0 message wording is preserved.
      await assert.rejects(
        remoteConfigServiceSkipCache({ appId: APP_ID, clusterName: CLUSTER, namespaceName: 'application' }),
        /configServerUrl is required/
      );
      // OpenApi inheritance surface is exempt (plan MIN-5): it does not
      // consume metaServerUrl and does not participate in the check, so
      // a config carrying both addresses still performs its token call.
      const result = await remoteConfigService({
        configServerUrl: mock.baseURL,
        metaServerUrl: mock.baseURL,
        appId: APP_ID,
        clusterName: CLUSTER,
        apolloEnv: 'dev',
        token: 'openapi-token',
      });
      assert.strictEqual(result['pub.key'], 'pub-value');
      assert.strictEqual(mock.requestsTo('/openapi/v1/').length, 1);
      assert.strictEqual(mock.requestsTo('/configs/').length, 0);
    } finally {
      await mock.close();
    }
  });
});

test('encoding boundaries: Chinese / dotted / spaced namespaces pass signature verification', async () => {
  await withoutSecretEnv(async () => {
    const secret = 'encoding-boundary-secret';
    const mock = await createApolloMockServer({ verifySecret: secret });
    try {
      const namespaces = ['公共命名空间', 'a.b.c', 'with space'];
      const result = await remoteConfigServiceSkipCache(baseConfig(mock, { namespaceName: namespaces, secret }));
      assert.deepStrictEqual(result, {
        '公共命名空间.k1': '公共命名空间-v1',
        'a.b.c.k1': 'a.b.c-v1',
        'with space.k1': 'with space-v1',
        shared: 'with space', // last namespace in the list wins
      });
      const urls = mock.requestsTo('/configs/').map((r) => r.url);
      assert.ok(urls.some((u) => u.includes(encodeURIComponent('公共命名空间'))));
      assert.ok(urls.some((u) => u.includes('/a.b.c')));
      assert.ok(urls.some((u) => u.includes(encodeURIComponent('with space'))));
    } finally {
      await mock.close();
    }
  });
});
