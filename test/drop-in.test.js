'use strict';

/**
 * Drop-in compatibility test (PRD AC-7, PLAN §7.6).
 *
 * The call sites below are copied verbatim from the node-apollo README
 * "Methods" section examples (the only supported migration path per
 * FR-3.5). Per the AC-7 verification recipe, exactly two things were
 * changed and nothing else:
 *   1. `require('node-apollo')` -> `require('..')` (the apollo-config-client
 *      package entry; equivalent to swapping the package name), and
 *   2. `configServerUrl` now points at the local mock server instead of
 *      a real Apollo host.
 * The parameter structure, function names (including the historical
 * spelling alias `remoteConfigServiceSikpCache`) and merge expectations
 * are untouched from the upstream README sample.
 *
 * v1.1 (PLAN §7.3): the sample configs carry no `clientIp`, so the
 * default auto-detection now appends `?ip=<local>`. Every network test
 * stubs `os.networkInterfaces` with the shared fixed table (eth0
 * 192.0.2.10) so the URL assertions are deterministic: exact-URL
 * assertions became `startsWith(...)` + a positive `?ip=192.0.2.10`
 * check. The sample code itself stays zero-change.
 */

const test = require('node:test');
const assert = require('node:assert');

const apollo = require('..');

const { createApolloMockServer, stubNetworkInterfaces } = require('./helpers/mock-server.js');

const ENV_KEYS = ['APOLLO_ACCESSKEY_SECRET', 'APOLLO_ACCESS_KEY_SECRET', 'APOLLO_ENV'];

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

const EXPECTED_MERGE = {
  'namespaceName1.k1': 'namespaceName1-v1',
  'namespaceName2.k1': 'namespaceName2-v1',
  shared: 'namespaceName2', // n1的配置会被n2配置覆盖
};

test('drop-in: remoteConfigServiceFromCache with the README sample config (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const restore = stubNetworkInterfaces(); // deterministic ?ip=192.0.2.10
    try {
      const config = {
        configServerUrl: mock.baseURL, // <-- only changed: was 'http://example.com'
        appId: '<appId>',
        clusterName: 'default',
        namespaceName: ['namespaceName1', 'namespaceName2'], // n1的配置会被n2配置覆盖
        // clientIp: '',
      };
      const result = await apollo.remoteConfigServiceFromCache(config);
      assert.deepStrictEqual(result, EXPECTED_MERGE);
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('drop-in: remoteConfigServiceSkipCache with the README sample config (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const restore = stubNetworkInterfaces(); // deterministic ?ip=192.0.2.10
    try {
      const config = {
        configServerUrl: mock.baseURL, // <-- only changed: was 'http://example.com'
        appId: '<appId>',
        clusterName: 'default',
        namespaceName: ['namespaceName1', 'namespaceName2'], // n1的配置会被n2配置覆盖
        // clientIp: '', // optional
        // releaseKey: '', // optional
      };
      const result = await apollo.remoteConfigServiceSkipCache(config);
      assert.deepStrictEqual(result, EXPECTED_MERGE);
      const urls = mock.requestsTo('/configs/').map((r) => r.url);
      // The literal '<appId>' placeholder from the README sample is
      // percent-encoded on the wire by the documented path-segment
      // hardening (README behavioral difference 2, Java escaper parity).
      // v1.1: the sample has no clientIp, so the auto-detected local IPv4
      // (stubbed to 192.0.2.10) is appended — startsWith + positive ip
      // assertion instead of the v1.0 exact match.
      assert.ok(
        urls.some((u) => u.startsWith('/configs/%3CappId%3E/default/namespaceName1?ip=192.0.2.10')),
        `expected namespaceName1 URL with detected ip, got ${urls.join(', ')}`
      );
      assert.ok(
        urls.some((u) => u.startsWith('/configs/%3CappId%3E/default/namespaceName2?ip=192.0.2.10')),
        `expected namespaceName2 URL with detected ip, got ${urls.join(', ')}`
      );
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('drop-in: historical spelling alias remoteConfigServiceSikpCache still works (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const restore = stubNetworkInterfaces();
    try {
      const config = {
        configServerUrl: mock.baseURL,
        appId: '<appId>',
        clusterName: 'default',
        namespaceName: ['namespaceName1', 'namespaceName2'],
      };
      const result = await apollo.remoteConfigServiceSikpCache(config);
      assert.deepStrictEqual(result, EXPECTED_MERGE);
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('drop-in: additive `secret` field enables the accesskey signature without breaking the baseline (AC-7)', async () => {
  await withoutSecretEnv(async () => {
    const secret = 'drop-in-verify-secret';
    const mock = await createApolloMockServer({ verifySecret: secret });
    const restore = stubNetworkInterfaces();
    try {
      // Same README sample, one additive field.
      const config = {
        configServerUrl: mock.baseURL,
        appId: '<appId>',
        clusterName: 'default',
        namespaceName: ['namespaceName1', 'namespaceName2'],
        secret, // additive accesskey option
      };
      const result = await apollo.remoteConfigServiceSkipCache(config);
      assert.deepStrictEqual(result, EXPECTED_MERGE); // mock verified the signatures (else 401)
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('drop-in: the full exported API surface of the base package is present', () => {
  // node-apollo exports these six; all must exist on the replacement.
  for (const name of [
    'remoteConfigService',
    'remoteConfigServiceSkipCache',
    'remoteConfigServiceSikpCache',
    'remoteConfigServiceFromCache',
    'createEnvFile',
    'setEnv',
  ]) {
    assert.strictEqual(typeof apollo[name], 'function', `${name} must be exported`);
  }
  // Additive accesskey surface (DF-2).
  for (const name of [
    'queryConfig',
    'signature',
    'buildHttpHeaders',
    'url2PathWithQuery',
    'resolveAccessKeySecret',
    'ApolloError',
    'ApolloUnauthorizedError',
    'ApolloHttpError',
    'ApolloNetworkError',
  ]) {
    assert.ok(apollo[name] !== undefined, `${name} must be exported`);
  }
});
