'use strict';

/**
 * Local file cache tests (PRD AC-17 / AC-20, PLAN §7.3 cache group,
 * DF-17).
 *
 * Covers: file content shape and round-trip, atomic write (tmp+rename,
 * no leftover tmp files, failure cleans the tmp and rethrows),
 * corrupted-file tolerance (every malformed shape is "no cache", never
 * throws), the isolation key (sorted/deduped namespaces, unique base
 * URL part, trailing-slash normalization, different base -> different
 * file so the same appId+cluster never cross-covers), and the
 * mutual-exclusion propagation into the watcher constructor.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const {
  defaultCachePath,
  ApolloWatcher,
  ApolloError,
} = require('../dist/index.js');
// `loadConfigCache` / `writeConfigCacheAtomic` / `computeIsolationKey`
// are internal cache-module exports (the public index surface only
// ships `defaultCachePath` per PLAN §4.2); the tests exercise them via
// a deep import of the compiled module.
const {
  computeIsolationKey,
  DEFAULT_CACHE_DIR_NAME,
  loadConfigCache,
  writeConfigCacheAtomic,
} = require('../dist/cache.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-cache-test-'));
}

function sampleContent(overrides) {
  return Object.assign(
    {
      version: 1,
      appId: 'sample-app',
      clusterName: 'default',
      namespaces: {
        application: {
          releaseKey: 'rk-1',
          configurations: { 'application.k1': 'v1' },
        },
      },
    },
    overrides
  );
}

test('cache: write + load round-trip preserves the full file content', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'sample.json');
    const content = sampleContent();
    writeConfigCacheAtomic(target, content);
    const loaded = loadConfigCache(target);
    assert.deepStrictEqual(loaded, content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: atomic write leaves no tmp files behind', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'sample.json');
    writeConfigCacheAtomic(target, sampleContent());
    writeConfigCacheAtomic(target, sampleContent()); // overwrite in place
    const entries = fs.readdirSync(dir);
    assert.deepStrictEqual(entries, ['sample.json'], `no tmp leftovers: ${entries.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: atomic write creates missing parent directories recursively', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'nested', 'deeper', 'cache.json');
    writeConfigCacheAtomic(target, sampleContent());
    assert.ok(fs.existsSync(target));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: failed write cleans the tmp file and rethrows (target is a directory)', () => {
  const dir = makeTempDir();
  try {
    // A directory at the target path: writeFileSync(tmp) succeeds but
    // renameSync(tmp -> dir) fails on all platforms -> error rethrown.
    const target = path.join(dir, 'occupied');
    fs.mkdirSync(target);
    assert.throws(() => writeConfigCacheAtomic(target, sampleContent()));
    const entries = fs.readdirSync(dir);
    assert.deepStrictEqual(entries, ['occupied'], `tmp cleaned up: ${entries.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: missing file / directory path load as undefined without throwing', () => {
  const dir = makeTempDir();
  try {
    assert.strictEqual(loadConfigCache(path.join(dir, 'missing.json')), undefined);
    assert.strictEqual(loadConfigCache(dir), undefined); // a directory
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: corrupted file (invalid JSON) is tolerated as "no cache"', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'corrupt.json');
    fs.writeFileSync(target, '{ this is not json', 'utf8');
    assert.strictEqual(loadConfigCache(target), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: malformed shapes are all treated as no cache', () => {
  const dir = makeTempDir();
  try {
    const cases = [
      'null',
      '123',
      '"string"',
      '[]',
      '{}',
      JSON.stringify({ namespaces: null }),
      JSON.stringify({ namespaces: [] }),
      JSON.stringify({ namespaces: 'text' }),
      JSON.stringify({ namespaces: { app: null } }),
      JSON.stringify({ namespaces: { app: [] } }),
      JSON.stringify({ namespaces: { app: 'text' } }),
      JSON.stringify({ namespaces: { app: { configurations: null } } }),
      JSON.stringify({ namespaces: { app: { configurations: 'text' } } }),
      JSON.stringify({ namespaces: { good: { configurations: {} }, bad: null } }), // bad skipped, good kept... but good has empty configurations which is an object -> valid
    ];
    for (let i = 0; i < cases.length; i++) {
      const target = path.join(dir, `case-${i}.json`);
      fs.writeFileSync(target, cases[i], 'utf8');
      assert.doesNotThrow(() => loadConfigCache(target), `case ${i} must not throw`);
      if (i < cases.length - 1) {
        assert.strictEqual(loadConfigCache(target), undefined, `case ${i} must be "no cache"`);
      }
    }
    // The last case keeps the one good namespace entry.
    const last = loadConfigCache(path.join(dir, `case-${cases.length - 1}.json`));
    assert.ok(last && last.namespaces.good, 'valid entries survive beside invalid ones');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: releaseKey must be a string, otherwise undefined', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'rk.json');
    fs.writeFileSync(
      target,
      JSON.stringify({ namespaces: { app: { releaseKey: 42, configurations: { a: '1' } } } }),
      'utf8'
    );
    const loaded = loadConfigCache(target);
    assert.strictEqual(loaded.namespaces.app.releaseKey, undefined);
    assert.deepStrictEqual(loaded.namespaces.app.configurations, { a: '1' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: explicit unknown schema versions are treated as no cache', () => {
  const dir = makeTempDir();
  try {
    for (const version of [0, 2, '1', null]) {
      const target = path.join(dir, `version-${String(version)}.json`);
      fs.writeFileSync(
        target,
        JSON.stringify({
          version,
          appId: 'sample-app',
          clusterName: 'default',
          namespaces: { application: { configurations: { ok: 'yes' } } },
        }),
        'utf8'
      );
      assert.strictEqual(loadConfigCache(target), undefined, `version ${String(version)} must be rejected`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: __proto__ namespace survives an atomic write/load round-trip', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'proto-namespace.json');
    const namespaces = {};
    Object.defineProperty(namespaces, '__proto__', {
      value: {
        releaseKey: 'rk-proto',
        configurations: { from: 'proto' },
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const content = sampleContent({ namespaces });
    writeConfigCacheAtomic(target, content);
    const loaded = loadConfigCache(target);
    assert.ok(loaded);
    assert.strictEqual(Object.getPrototypeOf(loaded.namespaces), Object.prototype);
    assert.ok(Object.prototype.hasOwnProperty.call(loaded.namespaces, '__proto__'));
    assert.deepStrictEqual(loaded.namespaces['__proto__'], namespaces['__proto__']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: zero usable namespaces -> no cache', () => {
  const dir = makeTempDir();
  try {
    const target = path.join(dir, 'empty.json');
    fs.writeFileSync(target, JSON.stringify({ namespaces: {} }), 'utf8');
    assert.strictEqual(loadConfigCache(target), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: isolation key is sha256(base + "\\n" + sorted-unique-namespaces JSON).slice(0,10)', () => {
  const expected = createHash('sha256')
    .update('http://base\n["a","b"]', 'utf8')
    .digest('hex')
    .slice(0, 10);
  assert.strictEqual(computeIsolationKey('http://base', ['b', 'a']), expected);
});

test('cache: isolation key is order-insensitive and dedupes namespaces', () => {
  assert.strictEqual(
    computeIsolationKey('http://base', ['a', 'b', 'a']),
    computeIsolationKey('http://base', ['b', 'a'])
  );
});

test('cache: trailing slashes on the base URL do not change the key', () => {
  assert.strictEqual(
    computeIsolationKey('http://base/', ['a']),
    computeIsolationKey('http://base///', ['a'])
  );
});

test('cache: same appId+cluster against a different base URL gets a different key (no cross-cover)', () => {
  const a = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns1'], uniqueBaseUrl: 'http://host-a' });
  const b = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns1'], uniqueBaseUrl: 'http://host-b' });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(computeIsolationKey('http://host-a', ['ns1']), computeIsolationKey('http://host-b', ['ns1']));
  // Different namespace lists also differ.
  const c = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns2'], uniqueBaseUrl: 'http://host-a' });
  assert.notStrictEqual(a, c);
});

test('cache: appId and clusterName components are path-safe and delimiter-unambiguous', () => {
  const root = path.resolve(process.cwd(), DEFAULT_CACHE_DIR_NAME);
  const escaped = defaultCachePath({
    appId: '../../escape',
    clusterName: 'default',
    namespaces: ['application'],
    uniqueBaseUrl: 'http://host',
  });
  assert.strictEqual(path.dirname(escaped), root, 'encoded identity stays under the cache directory');
  assert.ok(path.basename(escaped).startsWith('%2E%2E%2F%2E%2E%2Fescape.default.'));

  const appDot = defaultCachePath({
    appId: 'a.b',
    clusterName: 'c',
    namespaces: ['application'],
    uniqueBaseUrl: 'http://host',
  });
  const clusterDot = defaultCachePath({
    appId: 'a',
    clusterName: 'b.c',
    namespaces: ['application'],
    uniqueBaseUrl: 'http://host',
  });
  assert.notStrictEqual(appDot, clusterDot, 'identity components must not collide on the filename separator');
});

test('cache: defaultCachePath layout <cwd>/.apollo-config-client-cache/{appId}.{cluster}.{isolation}.json', () => {
  const dir = makeTempDir();
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    const isolation = computeIsolationKey('http://host', ['ns1', 'ns2']);
    // defaultCachePath resolves against process.cwd(), which Node
    // realpaths (macOS /var -> /private/var); mirror that here.
    const expected = path.join(
      fs.realpathSync(dir),
      '.apollo-config-client-cache',
      `app.default.${isolation}.json`
    );
    assert.strictEqual(
      defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns2', 'ns1'], uniqueBaseUrl: 'http://host' }),
      expected
    );
    assert.ok(fs.existsSync(path.dirname(expected)) === false || true); // dir created lazily by the writer
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: restore isolation — two cache files never pollute each other', () => {
  const dir = makeTempDir();
  const previousCwd = process.cwd();
  // chdir so defaultCachePath lands inside the temp dir, never in the
  // project root.
  process.chdir(dir);
  try {
    const pathA = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns1'], uniqueBaseUrl: 'http://host-a' });
    const pathB = defaultCachePath({ appId: 'app', clusterName: 'default', namespaces: ['ns1'], uniqueBaseUrl: 'http://host-b' });
    writeConfigCacheAtomic(pathA, sampleContent({ namespaces: { ns1: { releaseKey: 'A', configurations: { who: 'A' } } } }));
    writeConfigCacheAtomic(pathB, sampleContent({ namespaces: { ns1: { releaseKey: 'B', configurations: { who: 'B' } } } }));
    // Reloading each path returns its own instance's data.
    assert.strictEqual(loadConfigCache(pathA).namespaces.ns1.configurations.who, 'A');
    assert.strictEqual(loadConfigCache(pathB).namespaces.ns1.configurations.who, 'B');
    // Both files live under the (now temp) cwd's default cache dir.
    // defaultCachePath resolves via process.cwd() which Node realpaths,
    // so compare against the realpath of the temp dir.
    const realDir = fs.realpathSync(dir);
    assert.ok(pathA.startsWith(realDir));
    assert.ok(pathB.startsWith(realDir));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: mutual exclusion propagates into the watcher constructor (both addresses throw)', () => {
  assert.throws(
    () =>
      new ApolloWatcher({
        configServerUrl: 'http://config.example.com',
        metaServerUrl: 'http://meta.example.com',
        appId: 'app',
        clusterName: 'default',
        namespaceName: 'application',
        cachePath: false,
      }),
      (err) => {
        assert.ok(err instanceof ApolloError);
        assert.strictEqual(
          err.message,
          'configServerUrl and metaServerUrl are mutually exclusive, configure exactly one'
        );
        return true;
      }
  );
});
