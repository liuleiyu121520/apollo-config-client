'use strict';

/**
 * node-apollo equivalence tests (PLAN §7.5, v1.1 per §7.3 / MIN-4).
 *
 * The URL-construction layer of this package derives from node-apollo's
 * `lib/helper.js` (ISC). These tests pin the equivalence: for the base
 * argument set (configServerUrl / appId / clusterName / namespaceName /
 * releaseKey / clientIp — the equivalence baseline deliberately excludes
 * the new `dataCenter` field, per the MINOR-001 clarification), the URLs
 * actually sent by this package are string-equal to what
 * `require('node-apollo/lib/helper')` produces, and the merged results
 * of both clients are deep-equal against the same mock server.
 *
 * v1.1: the two default-semantics tests at the end are rewritten (MIN-4)
 * — both stub `os.networkInterfaces` with the shared fixed table
 * (lo 127.0.0.1 internal + eth0 192.0.2.10) so the default-carried IP is
 * deterministic: this package sends `?ip=192.0.2.10` and never an
 * `undefined` fragment, while the base builder still interpolates
 * `?ip=undefined` for a missing clientIp (the documented base defect).
 */

const test = require('node:test');
const assert = require('node:assert');

const baseApollo = require('node-apollo');
const helper = require('node-apollo/lib/helper');

const {
  remoteConfigServiceSkipCache,
  remoteConfigServiceFromCache,
} = require('../dist/index.js');

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

// Full-argument config restricted to the node-apollo base field set
// (ASCII values only: encodeURIComponent is identity for these, so the
// hardening cannot skew the comparison).
function fullBaseConfig(mock, extra) {
  return Object.assign(
    {
      configServerUrl: mock.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      namespaceName: ['ns1', 'ns2'],
      releaseKey: 'rk-20261026',
      clientIp: '10.0.0.1',
    },
    extra
  );
}

/**
 * Normalize both sides to `path + query` before comparing: the mock
 * records the on-the-wire `req.url` (already path + query, no origin),
 * while node-apollo's helpers return absolute URLs.
 */
function pathWithQueryOf(url) {
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  }
  return url;
}

test('URL equivalence: skipCache, full base args, array namespaces (§7.5)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const config = fullBaseConfig(mock);
      await remoteConfigServiceSkipCache(config);
      const ours = mock.requestsTo('/configs/').map((r) => pathWithQueryOf(r.url)).sort();
      const baseline = helper.getConfigSkipCacheUri(config).map(pathWithQueryOf).sort();
      assert.deepStrictEqual(ours, baseline);
    } finally {
      await mock.close();
    }
  });
});

test('URL equivalence: skipCache, full base args, single string namespace (§7.5)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const config = fullBaseConfig(mock, { namespaceName: 'application' });
      await remoteConfigServiceSkipCache(config);
      const ours = mock.requestsTo('/configs/').map((r) => pathWithQueryOf(r.url));
      const baseline = helper.getConfigSkipCacheUri(config).map(pathWithQueryOf);
      assert.deepStrictEqual(ours, baseline);
    } finally {
      await mock.close();
    }
  });
});

test('URL equivalence: fromCache with clientIp appends only ?ip= (§7.5)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const config = fullBaseConfig(mock);
      await remoteConfigServiceFromCache(config);
      const ours = mock.requestsTo('/configfiles/json/').map((r) => pathWithQueryOf(r.url)).sort();
      const baseline = helper.getConfigFromCacheUri(config).map(pathWithQueryOf).sort();
      assert.deepStrictEqual(ours, baseline);
    } finally {
      await mock.close();
    }
  });
});

test('documented difference: fromCache without clientIp — base ?ip=undefined, this package the detected ip', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    // MIN-4: stub the interface table so the auto-detected ip is
    // deterministic (eth0 192.0.2.10) instead of machine-dependent.
    const restore = stubNetworkInterfaces();
    try {
      const config = fullBaseConfig(mock, { clientIp: undefined });
      await remoteConfigServiceFromCache(config);
      const ours = mock.requestsTo('/configfiles/json/').map((r) => pathWithQueryOf(r.url)).sort();
      const baseline = helper.getConfigFromCacheUri(config).map(pathWithQueryOf).sort();
      // The upstream builder always interpolates `?ip=${clientIp}`, so a
      // missing clientIp yields `?ip=undefined` (the documented base
      // defect). String equivalence therefore intentionally does NOT
      // hold in this degraded case; the equivalence baseline is the
      // full-argument config (tests above). This package auto-detects
      // and carries the local IPv4 instead — deterministically
      // 192.0.2.10 under the stubbed table — and never emits an
      // `undefined` fragment.
      assert.ok(baseline.length > 0 && baseline.every((u) => u.includes('?ip=undefined')));
      assert.ok(ours.length > 0 && ours.every((u) => u.includes('?ip=192.0.2.10')));
      assert.ok(ours.every((u) => !u.includes('undefined')));
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('behavior equivalence: skipCache merged result deep-equals node-apollo (§7.5)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const config = fullBaseConfig(mock);
      const fromBase = await baseApollo.remoteConfigServiceSkipCache(config);
      const fromOurs = await remoteConfigServiceSkipCache(config);
      assert.deepStrictEqual(fromOurs, fromBase);
      assert.deepStrictEqual(fromOurs, {
        'ns1.k1': 'ns1-v1',
        'ns2.k1': 'ns2-v1',
        shared: 'ns2',
      });
    } finally {
      await mock.close();
    }
  });
});

test('behavior equivalence: fromCache merged result deep-equals node-apollo (§7.5)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    try {
      const config = fullBaseConfig(mock);
      const fromBase = await baseApollo.remoteConfigServiceFromCache(config);
      const fromOurs = await remoteConfigServiceFromCache(config);
      assert.deepStrictEqual(fromOurs, fromBase);
      assert.deepStrictEqual(fromOurs, {
        'ns1.k1': 'ns1-v1',
        'ns2.k1': 'ns2-v1',
        shared: 'ns2',
      });
    } finally {
      await mock.close();
    }
  });
});

test('regression: missing releaseKey/clientIp -> no `undefined` fragments, detected ip carried', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    // MIN-4: same fixed interface table as the other rewritten case.
    const restore = stubNetworkInterfaces();
    try {
      const config = {
        configServerUrl: mock.baseURL,
        appId: 'sample-app',
        clusterName: 'default',
        namespaceName: 'application',
        // releaseKey / clientIp intentionally absent; autoDetectIp defaults
        // to true -> the detected local IPv4 (192.0.2.10) is carried.
      };
      await remoteConfigServiceSkipCache(config);
      await remoteConfigServiceFromCache(config);
      for (const req of mock.requests) {
        assert.ok(!req.url.includes('undefined'), `no undefined fragment in ${req.url}`);
        assert.ok(req.url.includes('ip=192.0.2.10'), `detected ip carried in ${req.url}`);
      }
      const [skip] = mock.requestsTo('/configs/');
      const [cached] = mock.requestsTo('/configfiles/json/');
      assert.strictEqual(
        skip.url,
        '/configs/sample-app/default/application?ip=192.0.2.10'
      );
      assert.strictEqual(
        cached.url,
        '/configfiles/json/sample-app/default/application?ip=192.0.2.10'
      );
      // `autoDetectIp:false` restores the fully v1.0-shaped no-query URL.
      await remoteConfigServiceSkipCache({ ...config, autoDetectIp: false });
      const [, pinned] = mock.requestsTo('/configs/');
      assert.strictEqual(pinned.url, '/configs/sample-app/default/application');
    } finally {
      restore();
      await mock.close();
    }
  });
});

test('baseline sanity: node-apollo itself emits ?releaseKey=undefined&ip=undefined (documents the difference)', async () => {
  // This only inspects the upstream URL builder (no HTTP), proving the
  // difference above is an intentional fix, not a signature of a
  // different argument shape.
  const config = {
    configServerUrl: 'http://apollo.example.com',
    appId: 'sample-app',
    clusterName: 'default',
    namespaceName: 'application',
  };
  const baseline = helper.getConfigSkipCacheUri(config);
  assert.ok(baseline[0].includes('releaseKey=undefined&ip=undefined'));
});
