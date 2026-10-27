'use strict';

/**
 * Base-package inheritance surface tests (PLAN §7.6, DF-2).
 *
 * Covers createEnvFile / setEnv (including the MINOR-002 clarification:
 * a missing or unreadable .env file is silently ignored — no injection,
 * no throw, no override of existing variables) and the inherited
 * OpenApi passthrough `remoteConfigService` (token header passthrough
 * plus the base mergeConfig semantics).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createEnvFile,
  setEnv,
  remoteConfigService,
  ApolloHttpError,
  ApolloError,
  ApolloNetworkError,
} = require('../dist/index.js');
const helper = require('node-apollo/lib/helper');

const { createApolloMockServer } = require('./helpers/mock-server.js');

/** Create a private temp directory, removed in `cleanup`. */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-config-client-compat-'));
}

test('createEnvFile writes KEY=VALUE lines to the given file path', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'default.env');
    createEnvFile({ mongoose: 'mongo://127.0.0.1:27017', appId: 'sample-app' }, target);
    const content = fs.readFileSync(target, 'utf8');
    assert.deepStrictEqual(content.split('\n'), [
      'mongoose=mongo://127.0.0.1:27017',
      'appId=sample-app',
      '',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createEnvFile replaces an existing file instead of appending', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'default.env');
    fs.writeFileSync(target, 'OLD=stale\n', 'utf8');
    createEnvFile({ NEW: 'fresh' }, target);
    const content = fs.readFileSync(target, 'utf8');
    assert.ok(!content.includes('OLD=stale'));
    assert.strictEqual(content, 'NEW=fresh\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createEnvFile defaults to process.cwd()/default.env (documented path change)', () => {
  const dir = makeTempDir();
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    createEnvFile({ FROM: 'default-path' });
    assert.strictEqual(
      fs.readFileSync(path.join(dir, 'default.env'), 'utf8'),
      'FROM=default-path\n'
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setEnv injects new variables, skips comments, trims values', () => {
  const dir = makeTempDir();
  const injected = [];
  try {
    const target = path.join(dir, 'default.env');
    fs.writeFileSync(
      target,
      ['# a comment', '', 'APOLLO_COMPAT_A=  value-a  ', 'APOLLO_COMPAT_B=plain'].join('\n'),
      'utf8'
    );
    delete process.env.APOLLO_COMPAT_A;
    delete process.env.APOLLO_COMPAT_B;
    setEnv(target);
    assert.strictEqual(process.env.APOLLO_COMPAT_A, 'value-a');
    assert.strictEqual(process.env.APOLLO_COMPAT_B, 'plain');
    injected.push('APOLLO_COMPAT_A', 'APOLLO_COMPAT_B');
  } finally {
    for (const key of injected) {
      delete process.env[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setEnv never overrides existing environment variables (dotenv@4 semantics)', () => {
  const dir = makeTempDir();
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'APOLLO_COMPAT_EXISTING');
  const previous = process.env.APOLLO_COMPAT_EXISTING;
  try {
    const target = path.join(dir, 'default.env');
    fs.writeFileSync(target, 'APOLLO_COMPAT_EXISTING=from-file\n', 'utf8');
    process.env.APOLLO_COMPAT_EXISTING = 'pre-existing';
    setEnv(target);
    assert.strictEqual(process.env.APOLLO_COMPAT_EXISTING, 'pre-existing');
  } finally {
    if (hadKey) {
      process.env.APOLLO_COMPAT_EXISTING = previous;
    } else {
      delete process.env.APOLLO_COMPAT_EXISTING;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setEnv duplicate keys use the last value, matching dotenv@4', () => {
  const dir = makeTempDir();
  const key = 'APOLLO_COMPAT_DUPLICATE';
  try {
    const target = path.join(dir, 'default.env');
    fs.writeFileSync(target, `${key}=first\n${key}=second\n`, 'utf8');
    delete process.env[key];
    setEnv(target);
    assert.strictEqual(process.env[key], 'second');
  } finally {
    delete process.env[key];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MINOR-002: setEnv on a missing .env file is silent — no throw, no injection', () => {
  const missing = path.join(os.tmpdir(), `apollo-config-client-missing-${process.pid}-${Date.now()}.env`);
  const probeBefore = process.env.APOLLO_COMPAT_PROBE;
  assert.doesNotThrow(() => setEnv(missing));
  assert.strictEqual(process.env.APOLLO_COMPAT_PROBE, probeBefore);
});

test('MINOR-002: setEnv on an unreadable path (a directory) is silent too', () => {
  const dir = makeTempDir();
  try {
    // A directory at the env path: exists but is not a regular file.
    assert.doesNotThrow(() => setEnv(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setEnv defaults to process.cwd()/default.env', () => {
  const dir = makeTempDir();
  const injected = [];
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    fs.writeFileSync(path.join(dir, 'default.env'), 'APOLLO_COMPAT_DEFAULT=1\n', 'utf8');
    delete process.env.APOLLO_COMPAT_DEFAULT;
    setEnv();
    assert.strictEqual(process.env.APOLLO_COMPAT_DEFAULT, '1');
    injected.push('APOLLO_COMPAT_DEFAULT');
  } finally {
    process.chdir(previousCwd);
    for (const key of injected) {
      delete process.env[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// remoteConfigService (OpenApi passthrough, inherited from node-apollo).
// ---------------------------------------------------------------------------

test('remoteConfigService passes the token as the authorization header and merges items', async () => {
  const mock = await createApolloMockServer();
  try {
    const result = await remoteConfigService({
      configServerUrl: mock.baseURL,
      appId: 'sample-app',
      clusterName: 'default',
      apolloEnv: 'dev',
      token: 'openapi-token-123',
    });
    const [req] = mock.requestsTo('/openapi/v1/envs/dev/apps/sample-app/clusters/default/namespaces');
    assert.ok(req, 'expected one OpenApi request');
    assert.strictEqual(req.headers.authorization, 'openapi-token-123');
    assert.strictEqual(req.headers['content-type'], 'application/json;charset=UTF-8');
    // Base merge semantics with toJSON conversion.
    assert.deepStrictEqual(result, {
      'pub.key': 'pub-value',
      'json.key': { nested: 1 },
      'priv.key': 'priv-value',
      'plain.key': 'just a string',
    });
  } finally {
    await mock.close();
  }
});

test('remoteConfigService merge equals the upstream helper.mergeConfig for the same payload', async () => {
  const payload = [
    { isPublic: true, items: [{ key: 'shared', value: 'from-public' }, { key: 'p', value: '1' }] },
    { isPublic: false, items: [{ key: 'shared', value: 'from-private' }, { key: 'q', value: '2' }] },
  ];
  const mock = await createApolloMockServer();
  try {
    mock.setBehavior(() => ({ status: 200, body: JSON.stringify(payload) }));
    const ours = await remoteConfigService({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      apolloEnv: 'dev',
      token: 't',
    });
    assert.deepStrictEqual(ours, helper.mergeConfig(payload));
  } finally {
    await mock.close();
  }
});

test('remoteConfigService keeps special item keys as own data properties', async () => {
  const payload = [
    {
      isPublic: true,
      items: [
        { key: '__proto__', value: '{"winner":"public"}' },
        { key: 'constructor', value: 'public-constructor' },
        { key: 'toString', value: 'public-toString' },
        { key: 'shared', value: 'public' },
      ],
    },
    {
      isPublic: false,
      items: [
        { key: '__proto__', value: '{"winner":"private"}' },
        { key: 'constructor', value: 'private-constructor' },
        { key: 'toString', value: 'private-toString' },
        { key: 'shared', value: 'private' },
      ],
    },
  ];
  const mock = await createApolloMockServer();
  try {
    mock.setBehavior(() => ({ status: 200, body: JSON.stringify(payload) }));
    const result = await remoteConfigService({
      configServerUrl: mock.baseURL,
      appId: 'a',
      clusterName: 'default',
      apolloEnv: 'dev',
      token: 't',
    });
    assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
    assert.deepStrictEqual(Object.keys(result).sort(), [
      '__proto__',
      'constructor',
      'shared',
      'toString',
    ].sort());
    assert.deepStrictEqual(result['__proto__'], { winner: 'public' });
    assert.strictEqual(result.constructor, 'public-constructor');
    assert.strictEqual(result.toString, 'public-toString');
    assert.strictEqual(result.shared, 'public');
  } finally {
    await mock.close();
  }
});

test('remoteConfigService: non-200 raises ApolloHttpError with the base message wording', async () => {
  const mock = await createApolloMockServer();
  try {
    mock.setBehavior(() => ({ status: 500, body: '' }));
    await assert.rejects(
      remoteConfigService({
        configServerUrl: mock.baseURL,
        appId: 'a',
        clusterName: 'default',
        apolloEnv: 'dev',
        token: 't',
      }),
      (err) => {
        assert.ok(err instanceof ApolloHttpError);
        assert.strictEqual(err.statusCode, 500);
        assert.strictEqual(err.message, 'apollo host unavailable, please contact your administrtor');
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('remoteConfigService honors timeoutMs for the OpenApi request', async () => {
  const mock = await createApolloMockServer();
  mock.setBehavior((record) => {
    if (record.url.startsWith('/openapi/')) {
      return { status: 200, body: '[]', delayMs: 120 };
    }
    return null;
  });
  try {
    await assert.rejects(
      remoteConfigService({
        configServerUrl: mock.baseURL,
        appId: 'a',
        clusterName: 'default',
        apolloEnv: 'dev',
        token: 't',
        timeoutMs: 20,
      }),
      (err) => {
        assert.ok(err instanceof ApolloNetworkError);
        assert.match(err.message, /timed out after 20ms/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('remoteConfigService: missing token raises ApolloError like the base assert', async () => {
  const mock = await createApolloMockServer();
  try {
    await assert.rejects(
      remoteConfigService({ configServerUrl: mock.baseURL, appId: 'a', clusterName: 'c', apolloEnv: 'dev' }),
      (err) => {
        assert.ok(err instanceof ApolloError);
        assert.strictEqual(err.message, 'param token is required');
        return true;
      }
    );
    assert.strictEqual(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});
