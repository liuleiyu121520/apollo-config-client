'use strict';

/**
 * Long-polling watcher tests (PRD AC-15 / AC-16 / AC-17 / AC-20, PLAN
 * §7.2 scenario matrix, §5.1 notificationId state machine invariants,
 * §5.2 stop five steps).
 *
 * Scenario map (§7.2 ten scenarios):
 *   1  bootstrap: -1 ids, signed long poll, start() bounded
 *   2  304 continues with zero state mutation
 *   3  200 change -> signed refetch (no releaseKey) -> onChange full
 *      merged config -> next round carries the new id
 *   4  failure paths: warning + backoff, zero id mutation, retry
 *   5  backoff schedule 1s x2 capped, reset on success (accelerated)
 *   6  stop: five steps — suppress, abort in-flight, clear timer, reset
 *      (ids -1, fresh controller), restart reruns the full flow
 *   7  default long-poll timeout lower bound (90s) + configurable
 *   8  initTimeout bounded; cache recovery (onCacheLoaded + immediate
 *      start); watcher writes the cache after a change
 *   9  dual instances: (a) different appIds independent, (b) same
 *      appId+cluster different base URLs — isolated caches, no shared
 *      module state; watcher mutual-exclusion
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createApolloWatcher,
  ApolloWatcher,
  ApolloError,
  ApolloNetworkError,
} = require('../dist/index.js');
// The atomic cache writer is an internal cache-module export; the
// cache-recovery tests seed files through the same code path the
// watcher uses.
const { writeConfigCacheAtomic } = require('../dist/cache.js');
const {
  createApolloMockServer,
  computeApolloSignature,
  parseNotificationsQuery,
  stubNetworkInterfaces,
} = require('./helpers/mock-server.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-watch-test-'));
}

/**
 * Teardown helper: stop the watcher, give aborted in-flight requests a
 * moment to settle, then close the mock. Every watcher test must go
 * through this so no test leaks a socket/timer into the process.
 */
async function teardown(watcher, mock) {
  if (watcher) {
    watcher.stop();
  }
  await sleep(60);
  if (mock) {
    await mock.close();
  }
}

/** Extract the notifications payload of the n-th long poll (0-based). */
function nthNotificationsPayload(mock, n) {
  const polls = mock.requestsTo('/notifications/v2');
  assert.ok(polls.length > n, `expected more than ${n} polls, got ${polls.length}`);
  return parseNotificationsQuery(polls[n].url);
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for test condition');
    }
    await sleep(5);
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: bootstrap, signature, -1 ids (AC-15).
// ---------------------------------------------------------------------------

test('watch: bootstrap polls with -1 ids, signature verified, start resolves after the first round', async () => {
  await withoutSecretEnv(async () => {
    const secret = 'watch-signature-secret';
    const mock = await createApolloMockServer({ verifySecret: secret });
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        return { status: 304, body: '', holdMs: 15 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      namespaceName: ['application'],
      clientIp: '10.0.0.1',
      secret,
      cachePath: false,
    });
    try {
      const startedAt = Date.now();
      await watcher.start();
      assert.ok(Date.now() - startedAt < 5000, 'bootstrap completes on the first round');
      assert.strictEqual(watcher.isRunning(), true);
      assert.strictEqual(watcher.getConfig(), undefined, '304-only bootstrap has no data');
      assert.ok(polls >= 1, 'at least one long poll happened');
      const [first] = mock.requestsTo('/notifications/v2');
      assert.ok(first.url.startsWith('/notifications/v2?appId=sample-app&cluster=default&notifications='), first.url);
      assert.deepStrictEqual(parseNotificationsQuery(first.url), [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      // Signature headers verified by the mock (otherwise 401).
      assert.match(first.headers.authorization, /^Apollo sample-app:[A-Za-z0-9+/=]+$/);
      assert.match(first.headers.timestamp, /^\d{13}$/);
      assert.strictEqual(first.headers['content-type'], 'application/json;charset=UTF-8');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: multi-namespace initial payload carries -1 for every tracked namespace', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 304, body: '', holdMs: 15 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      namespaceName: ['ns1', 'ns2'],
      clientIp: '10.0.0.1',
      cachePath: false,
    });
    try {
      await watcher.start();
      assert.deepStrictEqual(nthNotificationsPayload(mock, 0), [
        { namespaceName: 'ns1', notificationId: -1 },
        { namespaceName: 'ns2', notificationId: -1 },
      ]);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: 304 continues with zero state mutation (AC-15).
// ---------------------------------------------------------------------------

test('watch: 304 rounds keep polling without mutating state or firing onChange', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changes.push(event),
    });
    try {
      await watcher.start();
      const atStart = mock.requestsTo('/notifications/v2').length;
      await sleep(120);
      const after = mock.requestsTo('/notifications/v2').length;
      assert.ok(after > atStart + 1, `polling continues (${atStart} -> ${after})`);
      assert.strictEqual(changes.length, 0, 'no onChange on 304');
      assert.strictEqual(watcher.getConfig(), undefined);
      // Every round still carries -1: zero state mutation.
      for (const payload of mock.requestsTo('/notifications/v2').map((r) => parseNotificationsQuery(r.url))) {
        assert.deepStrictEqual(payload, [{ namespaceName: 'application', notificationId: -1 }]);
      }
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: 200 change -> signed refetch without releaseKey -> onChange
// with the full merged config -> next round carries the new id (AC-15).
// ---------------------------------------------------------------------------

test('watch: 200 change refetches, fires onChange with the full merged config, advances the id', async () => {
  await withoutSecretEnv(async () => {
    const secret = 'change-secret';
    const mock = await createApolloMockServer({ verifySecret: secret });
    let polls = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 42 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null; // /configs refetch -> default 200 ApolloConfig
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      secret,
      cachePath: false,
      onChange: (event) => changes.push(event),
    });
    try {
      await watcher.start(); // first round: 200 + refetch + onChange
      assert.deepStrictEqual(watcher.getConfig(), {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      assert.strictEqual(changes.length, 1);
      assert.deepStrictEqual(changes[0], {
        config: { 'application.k1': 'application-v1', shared: 'application' },
        changedNamespaces: ['application'],
        source: 'server',
      });
      // The refetch went through the signed /configs endpoint WITHOUT a
      // releaseKey (plan §5.3).
      const [refetch] = mock.requestsTo('/configs/');
      assert.ok(refetch.url.startsWith('/configs/sample-app/default/application'), refetch.url);
      assert.ok(!refetch.url.includes('releaseKey'), `no releaseKey on refetch: ${refetch.url}`);
      assert.ok(refetch.url.includes('ip=10.0.0.1'));
      assert.match(refetch.headers.authorization, /^Apollo sample-app:/);
      // The next poll round carries the advanced id (42).
      await sleep(80);
      const secondPayload = nthNotificationsPayload(mock, 1);
      assert.deepStrictEqual(secondPayload, [
        { namespaceName: 'application', notificationId: 42 },
      ]);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: properties secret is re-read for every poll and refetch request', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const propertiesPath = path.join(dir, 'accesskey.properties');
    const oldSecret = 'watch-old-secret-0123456789';
    const newSecret = 'watch-new-secret-9876543210';
    fs.writeFileSync(propertiesPath, `apollo.accesskey.secret=${oldSecret}\n`);
    let polls = 0;
    let refetches = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 1 }]),
          };
        }
        if (polls === 2) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 2 }]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      if (record.url.startsWith('/configs/')) {
        refetches += 1;
        // The first refetch was already signed before this handler runs;
        // the next poll and refetch must observe the new file value.
        if (refetches === 1) {
          fs.writeFileSync(propertiesPath, `apollo.accesskey.secret=${newSecret}\n`);
        }
        return null;
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      propertiesPath,
      cachePath: false,
    });
    const assertSignature = (record, secret) => {
      assert.match(record.headers.timestamp, /^\d{13}$/);
      const expected = computeApolloSignature(secret, record.headers.timestamp, record.url);
      assert.strictEqual(record.headers.authorization, `Apollo a:${expected}`);
    };
    try {
      await watcher.start();
      await waitFor(() => mock.requestsTo('/configs/').length >= 2);
      const pollsRecorded = mock.requestsTo('/notifications/v2');
      const refetchesRecorded = mock.requestsTo('/configs/');
      assert.ok(pollsRecorded.length >= 2);
      assert.strictEqual(refetchesRecorded.length, 2);
      assertSignature(pollsRecorded[0], oldSecret);
      assertSignature(refetchesRecorded[0], oldSecret);
      assertSignature(pollsRecorded[1], newSecret);
      assertSignature(refetchesRecorded[1], newSecret);
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: multi-namespace change refetches both and merges in namespace order', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([
              { namespaceName: 'ns2', notificationId: 7 },
              { namespaceName: 'ns1', notificationId: 8 },
            ]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: ['ns1', 'ns2'],
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changes.push(event),
    });
    try {
      await watcher.start();
      assert.strictEqual(changes.length, 1);
      assert.deepStrictEqual(changes[0].changedNamespaces.slice().sort(), ['ns1', 'ns2']);
      assert.deepStrictEqual(changes[0].config, {
        'ns1.k1': 'ns1-v1',
        'ns2.k1': 'ns2-v1',
        shared: 'ns2', // ns2 overrides ns1 (namespace list order)
      });
      assert.strictEqual(mock.requestsTo('/configs/').length, 2);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: notificationId invariants — contains guard, failure keeps
// the id untouched (at-least-once), refetch 304 keeps the config.
// ---------------------------------------------------------------------------

test('watch: contains guard ignores untracked namespaces entirely', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([{ namespaceName: 'not-tracked', notificationId: 99 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changes.push(event),
    });
    try {
      await watcher.start();
      await sleep(60);
      assert.strictEqual(changes.length, 0, 'untracked namespace never fires onChange');
      assert.strictEqual(mock.requestsTo('/configs/').length, 0, 'no refetch for untracked ns');
      // Subsequent rounds still carry -1: the untracked id never enters
      // the state machine.
      assert.deepStrictEqual(nthNotificationsPayload(mock, 1), [
        { namespaceName: 'application', notificationId: -1 },
      ]);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: failed refetch keeps the notificationId untouched and retries (zero mutation)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const warnings = [];
    const changes = [];
    let refetches = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        // The server re-announces id 42 for the first two rounds because
        // the client never acknowledged it (at-least-once push).
        if (polls === 1 || polls === 2) {
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 42 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      if (record.url.startsWith('/configs/')) {
        refetches += 1;
        if (refetches === 1) {
          return { status: 500, body: 'boom' }; // first refetch fails
        }
        return null; // second refetch succeeds
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      retryInitialMs: 20,
      retryMaxMs: 60,
      cachePath: false,
      onChange: (event) => changes.push(event),
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      await sleep(120);
      assert.ok(warnings.length >= 1, 'refetch failure reported through onWarning');
      // Failure zero-mutation invariant: the failed round left the id at
      // its pre-round value (-1), so the retry poll re-announces -1 (the
      // server will push the same change again).
      const firstPayload = nthNotificationsPayload(mock, 0);
      assert.deepStrictEqual(firstPayload, [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      const secondPayload = nthNotificationsPayload(mock, 1);
      assert.deepStrictEqual(secondPayload, [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      await sleep(200);
      assert.strictEqual(changes.length, 1, 'the retried change eventually lands (at-least-once)');
      assert.deepStrictEqual(changes[0].config, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      // After the successful round the id is advanced to 42.
      await sleep(60);
      const thirdPayload = nthNotificationsPayload(mock, 2);
      assert.deepStrictEqual(thirdPayload, [
        { namespaceName: 'application', notificationId: 42 },
      ]);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: refetch answering 304 keeps the existing configuration without crashing', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const warnings = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 5 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      if (record.url.startsWith('/configs/')) {
        return { status: 304, body: '' };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      await sleep(60);
      assert.strictEqual(warnings.length, 0, 'a 304 refetch is not a failure');
      assert.strictEqual(watcher.getConfig(), undefined, 'nothing was ever fetched');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: invalid config payloads preserve committed state, cache, and notification id', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'invalid-payload.json');
    const malformedBodies = [null, [], {}, { configurations: [] }].map((body) =>
      JSON.stringify(body)
    );
    const expectedConfig = { 'valid.key': 'valid-value', shared: 'valid' };
    const warnings = [];
    const changes = [];
    let firstRound = true;
    let invalidRefetches = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        if (firstRound) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 1 }]),
          };
        }
        if (invalidRefetches < malformedBodies.length) {
          return {
            status: 200,
            body: JSON.stringify([
              { namespaceName: 'application', notificationId: invalidRefetches + 2 },
            ]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      if (record.url.startsWith('/configs/')) {
        if (firstRound) {
          firstRound = false;
          return {
            status: 200,
            body: JSON.stringify({
              releaseKey: 'valid-rk',
              configurations: expectedConfig,
            }),
          };
        }
        const body = malformedBodies[invalidRefetches];
        invalidRefetches += 1;
        return { status: 200, body };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      retryInitialMs: 5,
      retryMaxMs: 20,
      cachePath: cacheFile,
      onChange: (event) => changes.push(event),
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      const committedCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      await waitFor(() => invalidRefetches === malformedBodies.length);

      assert.deepStrictEqual(watcher.getConfig(), expectedConfig);
      assert.strictEqual(changes.length, 1, 'invalid payloads never fire onChange');
      assert.ok(warnings.length >= malformedBodies.length);
      for (const warning of warnings) {
        assert.strictEqual(warning.name, 'ApolloHttpError');
        assert.strictEqual(warning.statusCode, 200);
        assert.match(warning.url, /\/configs\/a\/default\/application/);
      }
      assert.deepStrictEqual(
        JSON.parse(fs.readFileSync(cacheFile, 'utf8')),
        committedCache,
        'invalid payloads never rewrite the last committed cache'
      );

      const notificationPayloads = mock
        .requestsTo('/notifications/v2')
        .map((record) => parseNotificationsQuery(record.url));
      assert.ok(notificationPayloads.length >= malformedBodies.length + 1);
      assert.deepStrictEqual(notificationPayloads[0], [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      for (const payload of notificationPayloads.slice(1)) {
        assert.deepStrictEqual(payload, [
          { namespaceName: 'application', notificationId: 1 },
        ]);
      }
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: non-array notifications payload is a reported failure, loop continues', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const warnings = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return { status: 200, holdMs: 10, body: '{"not":"an-array"}' };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      retryInitialMs: 20,
      cachePath: false,
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      await sleep(120);
      assert.ok(warnings.length >= 1);
      assert.match(warnings[0].message, /not an array/);
      assert.strictEqual(watcher.isRunning(), true, 'the loop keeps running');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: backoff schedule (accelerated: 40ms x2, cap 80ms, reset on
// success). AC-15 "故障后按策略自动重试且包不崩溃".
// ---------------------------------------------------------------------------

test('watch: backoff grows 1x2 to the cap and resets after a successful round', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const pollTimes = [];
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        pollTimes.push(Date.now());
        // rounds 1..3 fail, round 4 succeeds, round 5 fails again.
        if (polls <= 3 || polls === 5) {
          return { status: 404, body: '' };
        }
        return { status: 304, body: '', holdMs: 5 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      retryInitialMs: 40,
      retryMaxMs: 80,
      initTimeoutMs: 5000,
      cachePath: false,
    });
    try {
      // The bootstrap completes on round 4 (the first successful round),
      // so start() resolves — and the backoff reset is observable in the
      // gaps after that round.
      await watcher.start();
      await sleep(600);
      assert.ok(polls >= 6, `expected >= 6 rounds, got ${polls}`);
      const gaps = [];
      for (let i = 1; i < pollTimes.length; i++) {
        gaps.push(pollTimes[i] - pollTimes[i - 1]);
      }
      // Expected gap shape: [retryInitial 40, x2 80, cap 80, ~0 (success
      // round -> immediate next poll, no backoff), reset 40 (the next
      // failure starts over at retryInitial)].
      assert.ok(gaps[0] >= 35 && gaps[0] < 200, `gap1 ~40ms, got ${gaps[0]}`);
      assert.ok(gaps[1] >= 75 && gaps[1] < 300, `gap2 ~80ms (x2), got ${gaps[1]}`);
      assert.ok(gaps[2] >= 75 && gaps[2] < 300, `gap3 ~80ms (cap), got ${gaps[2]}`);
      assert.ok(gaps[3] < 40, `gap4 ~0ms (success round resets the schedule), got ${gaps[3]}`);
      if (gaps.length >= 5) {
        assert.ok(gaps[4] >= 35 && gaps[4] < 200, `gap5 ~40ms (backoff restarted from initial), got ${gaps[4]}`);
      }
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: stop five steps + restart with a fresh controller (AC-15/20).
// ---------------------------------------------------------------------------

test('watch: stop aborts the in-flight long poll, fires no onWarning, and never resumes', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const warnings = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        // Hold far beyond the test window: only stop() can end this.
        return { status: 200, body: '[]', holdMs: 30000 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onWarning: (err) => warnings.push(err),
    });
    try {
      const startPromise = watcher.start();
      await sleep(120); // the long poll is now in flight
      assert.strictEqual(watcher.isRunning(), true);
      const before = mock.requests.length;
      watcher.stop();
      // Step 2/3: the pending bootstrap settles (never hangs) and the
      // in-flight request is aborted (suppressed, NOT onWarning).
      await assert.rejects(startPromise, /stopped before bootstrap completed/);
      assert.strictEqual(watcher.isRunning(), false);
      assert.strictEqual(warnings.length, 0, 'stop-induced failures are never reported');
      // Give the socket teardown a moment to propagate to the server.
      await sleep(80);
      assert.ok(mock.abortedRequests >= 1, 'the in-flight connection was torn down');
      // Steps 4+5: no new request may arrive after stop (no resumption,
      // no backoff timer firing).
      await sleep(250);
      assert.strictEqual(mock.requests.length, before, 'no new request after stop');
      assert.strictEqual(watcher.getConfig(), undefined);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: stop during the backoff sleep exits at once (timer cleared, no late request)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const warnings = [];
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        return { status: 500, body: 'boom' }; // always failing -> backoff loop
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      retryInitialMs: 400, // long enough to stop inside the sleep
      retryMaxMs: 400,
      cachePath: false,
      onWarning: (err) => warnings.push(err),
    });
    try {
      const startPromise = watcher.start();
      await sleep(150); // poll #1 failed, now sleeping ~400ms
      assert.strictEqual(polls, 1);
      const before = mock.requests.length;
      watcher.stop();
      await assert.rejects(startPromise, /stopped before bootstrap completed/);
      assert.strictEqual(warnings.length, 1, 'the real 500 was reported once, stop adds nothing');
      // If the backoff timer were not cleared, the loop would wake after
      // ~400ms and fire another request inside this window.
      await sleep(550);
      assert.strictEqual(mock.requests.length, before, 'no late request after the backoff window');
      assert.strictEqual(watcher.isRunning(), false);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: stop during a refetch aborts it; restart runs the full flow on a fresh controller', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    let generation = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        generation += 1;
        return { status: 200, holdMs: 10, body: JSON.stringify([{ namespaceName: 'application', notificationId: generation }]) };
      }
      if (record.url.startsWith('/configs/')) {
        return { status: 200, holdMs: 30000, body: '{}' }; // hold the refetch
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changes.push(event),
    });
    try {
      const startPromise = watcher.start();
      await sleep(150); // change announced, refetch now in flight
      const pollsBeforeStop = mock.requestsTo('/notifications/v2').length;
      watcher.stop();
      await assert.rejects(startPromise, /stopped before bootstrap completed/);
      assert.strictEqual(changes.length, 0, 'the aborted refetch never produced onChange');
      // Give the socket teardown a moment to propagate to the server.
      await sleep(80);
      assert.ok(mock.abortedRequests >= 1, 'in-flight refetch connection torn down');
      // Restart (scenario: fresh controller, full flow reruns). The mock
      // now answers quickly: 200 change + instant refetch.
      mock.setBehavior((record) => {
        if (record.url.startsWith('/notifications/v2')) {
          polls += 1;
          return {
            status: 200,
            holdMs: 5,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 77 }]),
          };
        }
        return null;
      });
      const refetchCount = mock.requestsTo('/configs/').length;
      await watcher.start(); // resolves on the first completed round
      assert.strictEqual(watcher.isRunning(), true);
      assert.ok(mock.requestsTo('/notifications/v2').length > pollsBeforeStop, 'new poll round happened');
      assert.strictEqual(mock.requestsTo('/configs/').length, refetchCount + 1, 'a fresh refetch was issued');
      assert.deepStrictEqual(changes[0].config, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      // The restarted loop re-announced -1 (stop reset the ids). Anchor
      // at the restart boundary: gen-2's first poll is the one after the
      // pre-stop poll count.
      const payloadList = mock.requestsTo('/notifications/v2').map((r) => parseNotificationsQuery(r.url));
      assert.deepStrictEqual(payloadList[pollsBeforeStop], [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      // Give the loop a moment for the next round, then confirm the id
      // advanced to 77 (the successful round's announcement).
      await sleep(80);
      const payloadListAfter = mock.requestsTo('/notifications/v2').map((r) => parseNotificationsQuery(r.url));
      assert.deepStrictEqual(
        payloadListAfter[payloadListAfter.length - 1],
        [{ namespaceName: 'application', notificationId: 77 }]
      );
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: long-poll timeout default and configurability (AC-16).
// ---------------------------------------------------------------------------

test('watch: default long-poll timeout is 90s (> 60s server hold) and stays configurable', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    // A held request is cut by the long-poll timeout: with the default
    // 90s this test would hang, so only the CONFIGURED path is exercised
    // end-to-end; the 90s default is asserted as a constant lower bound.
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 200, body: '[]', holdMs: 30000 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      longPollTimeoutMs: 150,
      cachePath: false,
      onWarning: () => {},
    });
    try {
      const startPromise = watcher.start();
      await sleep(400);
      // The held request was aborted by the 150ms timeout (network
      // error -> warning + backoff), proving the timeout is wired in.
      assert.ok(watcher.isRunning(), 'the loop survives timeouts');
      const aborted = mock.abortedRequests;
      assert.ok(aborted >= 1, `held request timed out client-side (${aborted})`);
      watcher.stop();
      await assert.rejects(startPromise, /stopped before bootstrap completed/);
      // Default lower bound: Java RemoteConfigLongPollService uses 90s;
      // the default must exceed the ~60s server hold.
      const src = fs.readFileSync(path.resolve(__dirname, '../dist/watch.js'), 'utf8');
      assert.ok(src.includes('90000'), 'dist/watch.js embeds the 90000 default');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: initTimeout bounded; cache recovery and cache writing (AC-17).
// ---------------------------------------------------------------------------

test('watch: initTimeout bounds start() while the loop keeps retrying in the background', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 200, body: '[]', holdMs: 30000 }; // never completes
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      initTimeoutMs: 150,
      cachePath: false,
      onWarning: () => {},
    });
    try {
      const startedAt = Date.now();
      await assert.rejects(
        watcher.start(),
        (err) => {
          assert.ok(err instanceof ApolloError);
          assert.match(err.message, /bootstrap did not complete within 150ms/);
          return true;
        }
      );
      assert.ok(Date.now() - startedAt < 2000, 'the bootstrap deadline is bounded');
      assert.strictEqual(watcher.isRunning(), true, 'the watcher keeps retrying');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: a valid cache file recovers the configuration and resolves start() immediately', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'recovery.json');
    writeConfigCacheAtomic(cacheFile, {
      version: 1,
      appId: 'a',
      clusterName: 'default',
      namespaces: {
        application: { releaseKey: 'rk-cached', configurations: { cached: 'yes', n: '1' } },
      },
    });
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 200, body: '[]', holdMs: 30000 }; // server unreachable-ish
      }
      return null;
    });
    const cacheEvents = [];
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: cacheFile,
      onCacheLoaded: (event) => cacheEvents.push(event),
      onWarning: () => {},
    });
    try {
      const startedAt = Date.now();
      await watcher.start(); // resolves from the cache without waiting for the server
      assert.ok(Date.now() - startedAt < 1000, 'cache recovery resolves immediately');
      assert.deepStrictEqual(watcher.getConfig(), { cached: 'yes', n: '1' });
      assert.strictEqual(cacheEvents.length, 1);
      assert.deepStrictEqual(cacheEvents[0].config, { cached: 'yes', n: '1' });
      assert.strictEqual(watcher.isRunning(), true, 'the long-poll loop still runs');
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: a corrupted cache file is tolerated (bootstrap proceeds, no throw)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'corrupt.json');
    fs.writeFileSync(cacheFile, '{corrupted', 'utf8');
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const cacheEvents = [];
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: cacheFile,
      onCacheLoaded: (event) => cacheEvents.push(event),
    });
    try {
      await watcher.start();
      assert.strictEqual(cacheEvents.length, 0, 'no cache event for a corrupted file');
      assert.strictEqual(watcher.getConfig(), undefined);
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: a successful change persists the cache for the next process', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'persisted.json');
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 5,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 3 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: cacheFile,
    });
    try {
      await watcher.start();
      const loaded = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      assert.strictEqual(loaded.version, 1);
      assert.strictEqual(loaded.appId, 'a');
      assert.deepStrictEqual(loaded.namespaces.application.configurations, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      assert.strictEqual(loaded.namespaces.application.releaseKey, 'mock-release-key');
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: cache write failures surface through onWarning only (loop unharmed)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const warnings = [];
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            holdMs: 5,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 3 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    // A directory at the cache path: every write fails.
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: makeTempDir(), // exists as a directory -> write fails
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      await sleep(60);
      assert.strictEqual(warnings.length, 1, 'the write failure was reported once');
      assert.strictEqual(watcher.isRunning(), true, 'the loop is unharmed');
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: multi-instance independence + module-level zero shared
// mutable state + watcher mutual exclusion (AC-20).
// ---------------------------------------------------------------------------

test('watch: two instances with different appIds run independently (no cross-talk)', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const changesA = [];
    const changesB = [];
    let pollsA = 0;
    let pollsB = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2?appId=app-a')) {
        pollsA += 1;
        if (pollsA === 1) {
          // One single change; afterwards A stays on 304.
          return {
            status: 200,
            holdMs: 10,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 101 }]),
          };
        }
        return { status: 304, body: '', holdMs: 10 };
      }
      if (record.url.startsWith('/notifications/v2?appId=app-b')) {
        pollsB += 1;
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcherA = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'app-a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changesA.push(event),
    });
    const watcherB = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'app-b',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
      onChange: (event) => changesB.push(event),
    });
    try {
      await Promise.all([watcherA.start(), watcherB.start()]);
      await sleep(80);
      assert.strictEqual(changesA.length, 1, 'instance A got its change');
      assert.deepStrictEqual(changesA[0].config, {
        'application.k1': 'application-v1',
        shared: 'application',
      });
      assert.strictEqual(changesB.length, 0, 'instance B stayed on 304');
      assert.strictEqual(pollsA >= 1 && pollsB >= 1, true, 'both loops poll');
    } finally {
      await teardown(watcherA, null);
      await teardown(watcherB, mock);
    }
  });
});

test('watch: same appId+cluster against different base URLs keeps separate notification states (no shared module state)', async () => {
  await withoutSecretEnv(async () => {
    const mockA = await createApolloMockServer();
    const mockB = await createApolloMockServer();
    let pollCountB = 0;
    mockA.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return {
          status: 200,
          holdMs: 10,
          body: JSON.stringify([{ namespaceName: 'application', notificationId: 55 }]),
        };
      }
      return null;
    });
    mockB.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        pollCountB += 1;
        return { status: 304, body: '', holdMs: 10 };
      }
      return null;
    });
    const watcherA = createApolloWatcher({
      configServerUrl: mockA.baseURL,
      appId: 'same-app',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
    });
    const watcherB = createApolloWatcher({
      configServerUrl: mockB.baseURL,
      appId: 'same-app',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      cachePath: false,
    });
    try {
      await watcherA.start(); // A advanced its id to 55 (module state untouched)
      await watcherB.start();
      await sleep(60);
      // Instance B's first poll still announced -1 even though instance
      // A already advanced the same appId+cluster namespace to 55 — the
      // notification state is fully per-instance.
      const firstBPayload = parseNotificationsQuery(mockB.requestsTo('/notifications/v2')[0].url);
      assert.deepStrictEqual(firstBPayload, [
        { namespaceName: 'application', notificationId: -1 },
      ]);
      assert.ok(pollCountB >= 1);
    } finally {
      await teardown(watcherA, null);
      await teardown(watcherB, null);
      await mockA.close();
      await mockB.close();
    }
  });
});

test('watch: same appId+cluster different base URLs get different default cache files (isolation)', () => {
  const { defaultCachePath } = require('../dist/index.js');
  const pathA = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['application'], uniqueBaseUrl: 'http://host-a' });
  const pathB = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['application'], uniqueBaseUrl: 'http://host-b' });
  assert.notStrictEqual(pathA, pathB);
});

test('watch: both addresses configured throws the mutual-exclusion ApolloError', () => {
  assert.throws(
    () =>
      new ApolloWatcher({
        configServerUrl: 'http://config.example.com',
        metaServerUrl: 'http://meta.example.com',
        appId: 'a',
        clusterName: 'default',
        namespaceName: 'application',
      }),
      /configServerUrl and metaServerUrl are mutually exclusive, configure exactly one/
  );
});

// ---------------------------------------------------------------------------
// Discovery integration at the watcher level (AC-19).
// ---------------------------------------------------------------------------

test('watch: metaServerUrl-only watcher discovers the config service and long-polls through it', async () => {
  await withoutSecretEnv(async () => {
    const restore = stubNetworkInterfaces(); // deterministic ip in the meta query
    const meta = await createApolloMockServer(); // serves /services/config AND /notifications/v2
    try {
      const watcher = createApolloWatcher({
        metaServerUrl: meta.baseURL,
        appId: 'a',
        clusterName: 'default',
        namespaceName: 'application',
        retryInitialMs: 20,
        cachePath: false,
        onWarning: () => {},
      });
      await watcher.start();
      assert.strictEqual(meta.requestsTo('/services/config').length, 1, 'one discovery');
      const [discovery] = meta.requestsTo('/services/config');
      assert.strictEqual(discovery.headers.authorization, undefined, 'discovery is unsigned');
      assert.ok(meta.requestsTo('/notifications/v2').length >= 1, 'long poll through the discovered base');
      const [poll] = meta.requestsTo('/notifications/v2');
      assert.match(poll.url, /^\/notifications\/v2\?appId=a&cluster=default&notifications=/);
      watcher.stop();
      await sleep(60);
    } finally {
      restore();
      await meta.close();
    }
  });
});

test('watch: Meta discovery timeoutMs surfaces ApolloNetworkError through onWarning', async () => {
  await withoutSecretEnv(async () => {
    const meta = await createApolloMockServer();
    const warnings = [];
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
    const watcher = createApolloWatcher({
      metaServerUrl: meta.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      timeoutMs: 10,
      initTimeoutMs: 40,
      retryInitialMs: 5,
      cachePath: false,
      onWarning: (err) => warnings.push(err),
    });
    try {
      await assert.rejects(watcher.start(), /bootstrap did not complete/);
      assert.ok(
        warnings.some(
          (err) => err instanceof ApolloNetworkError && /\/services\/config/.test(err.url)
        )
      );
    } finally {
      await teardown(watcher, meta);
    }
  });
});

// ---------------------------------------------------------------------------
// onChange callback robustness (FR-12: callback errors never stop the loop).
// ---------------------------------------------------------------------------

test('watch: an onChange callback that throws is reported and never stops the loop', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const warnings = [];
    let polls = 0;
    let changes = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        return {
          status: 200,
          holdMs: 8,
          body: JSON.stringify([{ namespaceName: 'application', notificationId: polls }]),
        };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      clientIp: '10.0.0.1',
      retryInitialMs: 10,
      cachePath: false,
      onChange: () => {
        changes += 1;
        throw new Error('broken listener');
      },
      onWarning: (err) => warnings.push(err),
    });
    try {
      await watcher.start();
      await sleep(120);
      assert.ok(changes >= 2, `onChange fired repeatedly (${changes})`);
      assert.ok(warnings.length >= 1, 'callback errors reported via onWarning');
      assert.match(warnings[0].message, /broken listener/);
      assert.strictEqual(watcher.isRunning(), true);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: adversarial namespace keys, transactional rounds, cache
// identity, callback lifecycle, and thenable error handling.
// ---------------------------------------------------------------------------

test('watch: inherited namespace names are never treated as tracked', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    let polls = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: 'constructor', notificationId: 1 }]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      ...{
        configServerUrl: mock.baseURL,
        appId: 'a',
        clusterName: 'default',
        namespaceName: 'application',
        autoDetectIp: false,
        initTimeoutMs: 500,
        retryInitialMs: 10,
        cachePath: false,
      },
      onChange: (event) => changes.push(event),
    });
    try {
      await watcher.start();
      assert.strictEqual(mock.requestsTo('/configs/a/default/constructor').length, 0);
      assert.strictEqual(changes.length, 0);
      assert.strictEqual(watcher.getConfig(), undefined);
    } finally {
      await teardown(watcher, mock);
    }
  });
});

test('watch: a failed multi-namespace refetch commits no state, cache, or ids; retry commits once', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'transactional.json');
    let polls = 0;
    let brokenRefetches = 0;
    const changes = [];
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls <= 2) {
          return {
            status: 200,
            body: JSON.stringify([
              { namespaceName: 'application', notificationId: 1 },
              { namespaceName: 'broken', notificationId: 2 },
            ]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      if (record.url.startsWith('/configs/a/default/application')) {
        return {
          status: 200,
          body: JSON.stringify({
            releaseKey: 'application-rk',
            configurations: { 'application.key': 'application-value', shared: 'application' },
          }),
        };
      }
      if (record.url.startsWith('/configs/a/default/broken')) {
        brokenRefetches += 1;
        if (brokenRefetches === 1) {
          return { status: 500, body: 'broken' };
        }
        return {
          status: 200,
          body: JSON.stringify({
            releaseKey: 'broken-rk',
            configurations: { 'broken.key': 'broken-value', shared: 'broken' },
          }),
        };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: ['application', 'broken'],
      autoDetectIp: false,
      retryInitialMs: 100,
      initTimeoutMs: 1000,
      cachePath: cacheFile,
      onChange: (event) => changes.push(event),
    });
    const started = watcher.start();
    try {
      await waitFor(() => mock.requestsTo('/configs/a/default/broken').length >= 1);
      assert.strictEqual(watcher.getConfig(), undefined);
      assert.strictEqual(changes.length, 0);
      assert.strictEqual(fs.existsSync(cacheFile), false);
      assert.deepStrictEqual(nthNotificationsPayload(mock, 0), [
        { namespaceName: 'application', notificationId: -1 },
        { namespaceName: 'broken', notificationId: -1 },
      ]);

      await started;
      assert.deepStrictEqual(watcher.getConfig(), {
        'application.key': 'application-value',
        'broken.key': 'broken-value',
        shared: 'broken',
      });
      assert.strictEqual(changes.length, 1);
      assert.deepStrictEqual(changes[0].changedNamespaces, ['application', 'broken']);
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      assert.deepStrictEqual(Object.keys(cached.namespaces).sort(), ['application', 'broken']);
      await waitFor(() => mock.requestsTo('/notifications/v2').length >= 3);
      assert.deepStrictEqual(nthNotificationsPayload(mock, 1), [
        { namespaceName: 'application', notificationId: -1 },
        { namespaceName: 'broken', notificationId: -1 },
      ]);
      assert.deepStrictEqual(nthNotificationsPayload(mock, 2), [
        { namespaceName: 'application', notificationId: 1 },
        { namespaceName: 'broken', notificationId: 2 },
      ]);
    } finally {
      watcher.stop();
      await started.catch(() => {});
      await sleep(60);
      await mock.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: cache identity mismatch does not satisfy bootstrap from cache', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'wrong-identity.json');
    writeConfigCacheAtomic(cacheFile, {
      version: 1,
      appId: 'other-app',
      clusterName: 'default',
      namespaces: { application: { configurations: { cached: 'wrong' } } },
    });
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 304, body: '', holdMs: 30000 };
      }
      return null;
    });
    const cacheEvents = [];
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      cachePath: cacheFile,
      initTimeoutMs: 80,
      onCacheLoaded: (event) => cacheEvents.push(event),
      onWarning: () => {},
    });
    try {
      await assert.rejects(watcher.start(), /bootstrap did not complete within 80ms/);
      assert.strictEqual(cacheEvents.length, 0);
      assert.strictEqual(watcher.getConfig(), undefined);
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: stopping from onCacheLoaded prevents the outer start from launching a loop', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'callback-stop.json');
    writeConfigCacheAtomic(cacheFile, {
      version: 1,
      appId: 'a',
      clusterName: 'default',
      namespaces: { application: { configurations: { cached: 'yes' } } },
    });
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 304, body: '', holdMs: 30000 };
      }
      return null;
    });
    let watcher;
    watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      cachePath: cacheFile,
      onCacheLoaded: () => watcher.stop(),
    });
    try {
      await watcher.start();
      await sleep(20);
      assert.strictEqual(watcher.isRunning(), false);
      assert.strictEqual(mock.requests.length, 0);
    } finally {
      await teardown(watcher, mock);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: async onChange and onWarning failures are captured without unhandled rejections', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const unhandled = [];
    const warnings = [];
    let polls = 0;
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: 'application', notificationId: 1 }]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      cachePath: false,
      onChange: async () => {
        throw new Error('async callback failed');
      },
      onWarning: async (error) => {
        warnings.push(error);
        throw new Error('async warning callback failed');
      },
    });
    try {
      await watcher.start();
      await sleep(40);
      assert.ok(warnings.some((error) => /async callback failed/.test(error.message)));
      assert.strictEqual(unhandled.length, 0);
      assert.strictEqual(watcher.isRunning(), true);
    } finally {
      watcher.stop();
      process.removeListener('unhandledRejection', onUnhandled);
      await sleep(60);
      await mock.close();
    }
  });
});

test('watch: async onCacheLoaded failures are swallowed', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'async-cache-callback.json');
    writeConfigCacheAtomic(cacheFile, {
      version: 1,
      appId: 'a',
      clusterName: 'default',
      namespaces: { application: { configurations: { cached: 'yes' } } },
    });
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        return { status: 304, body: '', holdMs: 30000 };
      }
      return null;
    });
    const watcher = createApolloWatcher({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: 'application',
      autoDetectIp: false,
      cachePath: cacheFile,
      onCacheLoaded: async () => {
        throw new Error('async cache callback failed');
      },
    });
    try {
      await watcher.start();
      await sleep(40);
      assert.strictEqual(unhandled.length, 0);
    } finally {
      watcher.stop();
      process.removeListener('unhandledRejection', onUnhandled);
      await sleep(60);
      await mock.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('watch: __proto__ namespace and config keys round-trip as own data keys', async () => {
  await withoutSecretEnv(async () => {
    const mock = await createApolloMockServer();
    const dir = makeTempDir();
    const cacheFile = path.join(dir, 'proto-roundtrip.json');
    let polls = 0;
    mock.setBehavior((record) => {
      if (record.url.startsWith('/notifications/v2')) {
        polls += 1;
        if (polls === 1) {
          return {
            status: 200,
            body: JSON.stringify([{ namespaceName: '__proto__', notificationId: 1 }]),
          };
        }
        return { status: 304, body: '', holdMs: 30000 };
      }
      if (record.url.startsWith('/configs/a/default/__proto__')) {
        const configurations = JSON.parse('{"__proto__":"safe-value","regular":"ok"}');
        return {
          status: 200,
          body: JSON.stringify({ releaseKey: 'proto-rk', configurations }),
        };
      }
      return null;
    });
    const options = {
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      namespaceName: '__proto__',
      autoDetectIp: false,
      cachePath: cacheFile,
    };
    const watcher = createApolloWatcher(options);
    try {
      await watcher.start();
      const config = watcher.getConfig();
      assert.strictEqual(Object.getPrototypeOf(config), Object.prototype);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(config, '__proto__'), true);
      assert.strictEqual(config.__proto__, 'safe-value');
      assert.strictEqual(config.regular, 'ok');
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      assert.strictEqual(Object.prototype.hasOwnProperty.call(cached.namespaces, '__proto__'), true);
      assert.strictEqual(cached.namespaces.__proto__.configurations.__proto__, 'safe-value');
    } finally {
      await teardown(watcher, mock);
    }

    const recovered = createApolloWatcher(options);
    try {
      await recovered.start();
      const config = recovered.getConfig();
      assert.strictEqual(Object.getPrototypeOf(config), Object.prototype);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(config, '__proto__'), true);
      assert.strictEqual(config.__proto__, 'safe-value');
    } finally {
      await teardown(recovered, mock);
      await mock.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
