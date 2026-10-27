'use strict';

/**
 * Meta-server service discovery tests (PRD AC-19, PLAN §7.3 /
 * DF-18).
 *
 * Covers: unsigned `/services/config` requests, homepageUrl resolution,
 * TTL memoization (repeat calls do not re-fetch), forceRefresh, TTL
 * expiry refresh with an A→B list switch, failure keeps the previous
 * list (network / HTTP / empty list / invalid JSON / non-array), only a
 * discovery without a previous address throws, aborted signals always
 * reject (no stale fallback), appId/ip query wiring and
 * `invalidateDiscoveryCache`.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  invalidateDiscoveryCache,
  remoteConfigServiceSkipCache,
} = require('../dist/index.js');
// `resolveConfigServiceBaseUrl` is an internal discovery-module export
// (the public index surface ships only `invalidateDiscoveryCache` per
// PLAN §4.2); the tests exercise it via a deep import.
const { resolveConfigServiceBaseUrl } = require('../dist/discovery.js');
const { createApolloMockServer } = require('./helpers/mock-server.js');

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every test starts from an empty discovery memo for hermeticity.
test.beforeEach(() => {
  invalidateDiscoveryCache();
});

test('discovery: resolves homepageUrl through an UNSIGNED /services/config request', async () => {
  const mock = await createApolloMockServer();
  try {
    const url = await resolveConfigServiceBaseUrl({
      metaServerUrl: mock.baseURL,
      appId: 'sample-app',
      ip: '10.0.0.1',
    });
    assert.strictEqual(url, mock.baseURL);
    const [req] = mock.requestsTo('/services/config?');
    assert.ok(req, 'expected one discovery request');
    assert.strictEqual(req.url, `/services/config?appId=sample-app&ip=10.0.0.1`);
    // Java ConfigServiceLocator: the meta request carries no signature.
    assert.strictEqual(req.headers.authorization, undefined);
    assert.strictEqual(req.headers.timestamp, undefined);
  } finally {
    await mock.close();
  }
});

test('discovery: no ip option -> no ip query parameter', async () => {
  const mock = await createApolloMockServer();
  try {
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    const [req] = mock.requestsTo('/services/config');
    assert.strictEqual(req.url, '/services/config?appId=a');
  } finally {
    await mock.close();
  }
});

test('discovery: TTL memo — repeated calls do not re-fetch', async () => {
  const mock = await createApolloMockServer();
  try {
    const first = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    const second = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(first, second);
    assert.strictEqual(mock.requestsTo('/services/config').length, 1, 'memo hit must not fetch');
  } finally {
    await mock.close();
  }
});

test('discovery: memo key keeps delimiter-containing identities isolated', async () => {
  const mock = await createApolloMockServer();
  try {
    mock.setBehavior((record) => {
      if (record.url.startsWith('/path::x/services/config')) {
        return {
          status: 200,
          body: JSON.stringify([{ homepageUrl: 'http://service-a.example' }]),
        };
      }
      if (record.url.startsWith('/path/services/config')) {
        return {
          status: 200,
          body: JSON.stringify([{ homepageUrl: 'http://service-b.example' }]),
        };
      }
      return null;
    });
    const first = await resolveConfigServiceBaseUrl({
      metaServerUrl: `${mock.baseURL}/path::x`,
      appId: 'y',
    });
    const second = await resolveConfigServiceBaseUrl({
      metaServerUrl: `${mock.baseURL}/path`,
      appId: 'x::y',
    });
    assert.strictEqual(first, 'http://service-a.example');
    assert.strictEqual(second, 'http://service-b.example');
    assert.strictEqual(mock.requests.length, 2, 'distinct tuple identities must each discover');
  } finally {
    await mock.close();
  }
});

test('discovery: forceRefresh bypasses the memo and switches A -> B', async () => {
  const mock = await createApolloMockServer();
  try {
    const metaA = await createApolloMockServer();
    const metaB = await createApolloMockServer();
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      JSON.stringify([{ homepageUrl: metaB.baseURL }]),
    ]);
    const a = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    const a2 = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(a, metaA.baseURL);
    assert.strictEqual(a2, metaA.baseURL, 'still memoized');
    const b = await resolveConfigServiceBaseUrl({
      metaServerUrl: mock.baseURL,
      appId: 'a',
    }, { forceRefresh: true });
    assert.strictEqual(b, metaB.baseURL, 'forced refresh picks the new list');
    assert.strictEqual(mock.requestsTo('/services/config').length, 2);
    await metaA.close();
    await metaB.close();
  } finally {
    await mock.close();
  }
});

test('discovery: TTL expiry triggers a refresh (A -> B after the TTL)', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  const metaB = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      JSON.stringify([{ homepageUrl: metaB.baseURL }]),
    ]);
    const a = await resolveConfigServiceBaseUrl({
      metaServerUrl: mock.baseURL,
      appId: 'a',
      discoveryRefreshMs: 20,
    });
    assert.strictEqual(a, metaA.baseURL);
    await sleep(60); // let the 20ms TTL lapse
    const b = await resolveConfigServiceBaseUrl({
      metaServerUrl: mock.baseURL,
      appId: 'a',
      discoveryRefreshMs: 20,
    });
    assert.strictEqual(b, metaB.baseURL, 'expired memo re-fetches');
    assert.strictEqual(mock.requestsTo('/services/config').length, 2);
  } finally {
    await metaA.close();
    await metaB.close();
    await mock.close();
  }
});

test('discovery: failed refresh keeps the previous list and reports via onWarning (HTTP 500)', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      'simulated server error', // HTTP 200? no: make it fail with 500 below
    ]);
    // First resolution: A.
    const a = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(a, metaA.baseURL);
    // Second resolution with forceRefresh: the service answers 500.
    mock.setBehavior((record) => {
      if (record.url.startsWith('/services/config')) {
        return { status: 500, body: 'boom' };
      }
      return null;
    });
    const warnings = [];
    const again = await resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a', onWarning: (e) => warnings.push(e) },
      { forceRefresh: true }
    );
    assert.strictEqual(again, metaA.baseURL, 'previous list survives a failed refresh');
    assert.strictEqual(warnings.length, 1, 'failure reported through onWarning');
    assert.strictEqual(mock.requestsTo('/services/config').length, 2);
  } finally {
    await metaA.close();
    await mock.close();
  }
});

test('discovery: empty service list is a failure (keeps previous; throws when none)', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  try {
    // No previous address: an empty list must throw.
    mock.setServiceSequence([JSON.stringify([])]);
    await assert.rejects(
      resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' }),
      /empty service list/
    );
    // With a previous address: the empty list keeps it (Java :246-252).
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      JSON.stringify([]),
    ]);
    const first = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(first, metaA.baseURL);
    const warnings = [];
    const second = await resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a', onWarning: (e) => warnings.push(e) },
      { forceRefresh: true }
    );
    assert.strictEqual(second, metaA.baseURL);
    assert.strictEqual(warnings.length, 1);
  } finally {
    await metaA.close();
    await mock.close();
  }
});

test('discovery: invalid JSON / non-array payload are failures with fallback', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      'not json at all',
      JSON.stringify({ oops: 'object-not-array' }),
    ]);
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    const warnings = [];
    const fallback1 = await resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a', onWarning: (e) => warnings.push(e) },
      { forceRefresh: true }
    );
    const fallback2 = await resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a', onWarning: (e) => warnings.push(e) },
      { forceRefresh: true }
    );
    assert.strictEqual(fallback1, metaA.baseURL);
    assert.strictEqual(fallback2, metaA.baseURL);
    assert.strictEqual(warnings.length, 2);
  } finally {
    await metaA.close();
    await mock.close();
  }
});

test('discovery: entries without homepageUrl are skipped; trailing slashes normalized', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([
        { nope: 1 },
        null,
        { homepageUrl: `${metaA.baseURL}/` },
      ]),
    ]);
    const url = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(url, metaA.baseURL);
  } finally {
    await metaA.close();
    await mock.close();
  }
});

test('discovery: invalid homepageUrl entries are skipped and all-invalid refreshes fall back', async () => {
  const mock = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([
        { homepageUrl: ' not-a-url ' },
        { homepageUrl: ' ftp://invalid.example/ ' },
        { homepageUrl: '  https://valid.example/config///  ' },
      ]),
      JSON.stringify([
        { homepageUrl: 'not-a-url' },
        { homepageUrl: 'ftp://invalid.example' },
        { homepageUrl: '   ' },
      ]),
    ]);

    // A mixed response must retain the valid absolute HTTP(S) candidate,
    // trim surrounding whitespace, and preserve its path prefix.
    const first = await resolveConfigServiceBaseUrl({
      metaServerUrl: mock.baseURL,
      appId: 'a',
    });
    assert.strictEqual(first, 'https://valid.example/config');

    // A refresh with no valid candidates is the same failure as an empty
    // service list: keep the previous address and report one warning.
    const warnings = [];
    const fallback = await resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a', onWarning: (e) => warnings.push(e) },
      { forceRefresh: true }
    );
    assert.strictEqual(fallback, first);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0].message, /empty service list/);

    // Without a previous address, an all-invalid response must reject with
    // the existing ApolloError empty-list contract.
    invalidateDiscoveryCache();
    await assert.rejects(
      resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' }),
      (err) => {
        assert.strictEqual(err.name, 'ApolloError');
        assert.match(err.message, /empty service list/);
        return true;
      }
    );
    assert.strictEqual(mock.requestsTo('/services/config').length, 3);
  } finally {
    await mock.close();
  }
});

test('discovery: no previous address + failing fetch throws; aborted signal rejects (no stale fallback)', async () => {
  const mock = await createApolloMockServer();
  try {
    // No previous address: a failing discovery throws.
    mock.setBehavior((record) => {
      if (record.url.startsWith('/services/config')) {
        return { status: 500, body: 'boom' };
      }
      return null;
    });
    await assert.rejects(
      resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' }),
      (err) => err.name === 'ApolloHttpError' || err.name === 'ApolloError'
    );
    // An already-aborted signal rejects immediately without a request.
    invalidateDiscoveryCache();
    mock.resetBehavior();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      resolveConfigServiceBaseUrl(
        { metaServerUrl: mock.baseURL, appId: 'a' },
        { signal: controller.signal }
      )
    );
    assert.strictEqual(mock.requestsTo('/services/config').length, 1, 'aborted call sent nothing new');
    // Abort while in flight (held response): rejects with the abort error.
    invalidateDiscoveryCache();
    mock.setBehavior((record) => {
      if (record.url.startsWith('/services/config')) {
        return { status: 200, body: '[]', holdMs: 5000 };
      }
      return null;
    });
    const midFlight = new AbortController();
    const pending = resolveConfigServiceBaseUrl(
      { metaServerUrl: mock.baseURL, appId: 'a' },
      { signal: midFlight.signal }
    );
    setTimeout(() => midFlight.abort(), 50);
    await assert.rejects(pending, (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /aborted by signal/);
      return true;
    });
  } finally {
    await mock.close();
  }
});

test('discovery: an already-aborted signal rejects even on a warm TTL memo hit', async () => {
  const mock = await createApolloMockServer();
  try {
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      resolveConfigServiceBaseUrl(
        { metaServerUrl: mock.baseURL, appId: 'a' },
        { signal: controller.signal }
      ),
      (err) => {
        assert.strictEqual(err.name, 'ApolloNetworkError');
        assert.match(err.message, /aborted by signal/);
        return true;
      }
    );
    assert.strictEqual(mock.requestsTo('/services/config').length, 1, 'memo hit must not issue another request');
  } finally {
    await mock.close();
  }
});

test('discovery: invalid inputs (missing metaServerUrl / appId) throw without requests', async () => {
  const mock = await createApolloMockServer();
  try {
    await assert.rejects(
      resolveConfigServiceBaseUrl({ metaServerUrl: '', appId: 'a' }),
      /metaServerUrl is required/
    );
    await assert.rejects(
      resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: '' }),
      /appId is required/
    );
    assert.strictEqual(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test('discovery: invalidateDiscoveryCache clears the memo (next call re-fetches)', async () => {
  const mock = await createApolloMockServer();
  try {
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(mock.requestsTo('/services/config').length, 1);
    invalidateDiscoveryCache();
    await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'a' });
    assert.strictEqual(mock.requestsTo('/services/config').length, 2);
  } finally {
    await mock.close();
  }
});

test('discovery: different appIds are isolated in the memo (multi-instance safety)', async () => {
  const mock = await createApolloMockServer();
  const metaA = await createApolloMockServer();
  const metaB = await createApolloMockServer();
  try {
    mock.setServiceSequence([
      JSON.stringify([{ homepageUrl: metaA.baseURL }]),
      JSON.stringify([{ homepageUrl: metaB.baseURL }]),
    ]);
    // appA resolves to metaA; appB cannot reuse appA's memo entry and
    // consumes the next sequence entry (metaB).
    const forA = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'appA' });
    const forA2 = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'appA' });
    const forB = await resolveConfigServiceBaseUrl({ metaServerUrl: mock.baseURL, appId: 'appB' });
    assert.strictEqual(forA, metaA.baseURL);
    assert.strictEqual(forA2, metaA.baseURL, 'appA still memoized');
    assert.strictEqual(forB, metaB.baseURL, 'appB did its own discovery');
    assert.strictEqual(mock.requestsTo('/services/config').length, 2);
  } finally {
    await metaA.close();
    await metaB.close();
    await mock.close();
  }
});

test('client integration: metaServerUrl-only skipCache fetches through the discovered base', async () => {
  await withoutSecretEnv(async () => {
    const meta = await createApolloMockServer(); // serves /services/config
    // Discovery returns the config-service base; here the same mock also
    // serves /configs, so the flow is fully local.
    const result = await remoteConfigServiceSkipCache({
      metaServerUrl: meta.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
    });
    assert.deepStrictEqual(result, { 'application.k1': 'application-v1', shared: 'application' });
    assert.strictEqual(meta.requestsTo('/services/config').length, 1);
    assert.strictEqual(meta.requestsTo('/configs/').length, 1);
    await meta.close();
  });
});
