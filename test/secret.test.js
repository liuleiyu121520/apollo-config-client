'use strict';

/**
 * Access key secret resolution matrix (PRD AC-5a / AC-5b / AC-5c /
 * AC-6, PLAN §7.4 and DF-6).
 *
 * Chain (first non-blank wins, trimmed):
 *   explicit secret > APOLLO_ACCESSKEY_SECRET (legacy, primary) >
 *   APOLLO_ACCESS_KEY_SECRET (new name) > properties file.
 *
 * Properties keys: `apollo.accesskey.secret.{env}` >
 * `apollo.access-key.secret.{env}` > `apollo.accesskey.secret` >
 * `apollo.access-key.secret`; `env` = option > APOLLO_ENV; no env means
 * only suffix-less keys match. A missing file resolves to undefined and
 * never throws.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveAccessKeySecret } = require('../dist/index.js');
// `parseKeyValueText` is intentionally NOT on the public index surface
// (PLAN §4.2/§5 API list); the parsing kernel is reachable via a deep
// import of the compiled module, mirroring how tests exercise
// node-apollo's `lib/helper` internally.
const { parseKeyValueText } = require('../dist/secret.js');

const ENV_KEYS = ['APOLLO_ACCESSKEY_SECRET', 'APOLLO_ACCESS_KEY_SECRET', 'APOLLO_ENV'];

/**
 * Save-delete-restore fixture for the secret-related environment
 * variables: all three keys are removed, then `overrides` are applied
 * (only string values; undefined means "keep removed"), and everything
 * is restored after `fn` returns.
 */
function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const key of ENV_KEYS) {
    if (typeof overrides[key] === 'string') {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

/** Create a temp dir with one properties file written from `content`. */
function writeTempProperties(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-config-client-test-'));
  const filePath = path.join(dir, 'secrets.properties');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

const MISSING_FILE = path.join(os.tmpdir(), `apollo-config-client-not-exist-${process.pid}-${Date.now()}.properties`);

test('explicit secret wins over everything and is trimmed (AC-5a / AC-6 layer 1)', () => {
  const propsFile = writeTempProperties('apollo.accesskey.secret=file-secret\n');
  withEnv(
    { APOLLO_ACCESSKEY_SECRET: 'env-secret', APOLLO_ACCESS_KEY_SECRET: 'env-secret-new' },
    () => {
      assert.strictEqual(
        resolveAccessKeySecret({ secret: '  explicit-secret  ', propertiesPath: propsFile }),
        'explicit-secret'
      );
    }
  );
});

test('blank explicit secret falls through to the environment layer', () => {
  withEnv({ APOLLO_ACCESSKEY_SECRET: 'env-secret' }, () => {
    assert.strictEqual(resolveAccessKeySecret({ secret: '   ', propertiesPath: MISSING_FILE }), 'env-secret');
    assert.strictEqual(resolveAccessKeySecret({ secret: '', propertiesPath: MISSING_FILE }), 'env-secret');
  });
});

test('environment variables: legacy name only (AC-5b)', () => {
  withEnv({ APOLLO_ACCESSKEY_SECRET: 'legacy-secret' }, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), 'legacy-secret');
  });
});

test('environment variables: new name only, compatibility path (AC-5b)', () => {
  withEnv({ APOLLO_ACCESS_KEY_SECRET: 'new-secret' }, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), 'new-secret');
  });
});

test('environment variables: both set -> legacy name wins (AC-5b, PRD D-3)', () => {
  withEnv(
    { APOLLO_ACCESSKEY_SECRET: 'legacy-secret', APOLLO_ACCESS_KEY_SECRET: 'new-secret' },
    () => {
      assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), 'legacy-secret');
    }
  );
});

test('environment variables: blank values fall through to the next layer', () => {
  withEnv(
    { APOLLO_ACCESSKEY_SECRET: '   ', APOLLO_ACCESS_KEY_SECRET: 'new-secret' },
    () => {
      assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), 'new-secret');
    }
  );
});

test('priority: explicit > legacy env > new-name env > file (AC-6)', () => {
  const propsFile = writeTempProperties('apollo.accesskey.secret=file-secret\n');
  withEnv(
    { APOLLO_ACCESSKEY_SECRET: 'legacy-secret', APOLLO_ACCESS_KEY_SECRET: 'new-secret' },
    () => {
      assert.strictEqual(resolveAccessKeySecret({ secret: 'explicit', propertiesPath: propsFile }), 'explicit');
      assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'legacy-secret');
    }
  );
  withEnv({ APOLLO_ACCESS_KEY_SECRET: 'new-secret' }, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'new-secret');
  });
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'file-secret');
  });
});

test('properties: suffix-less legacy key `apollo.accesskey.secret` (AC-5c, no env)', () => {
  const propsFile = writeTempProperties(
    [
      '# comment',
      'apollo.accesskey.secret = suffixless-secret',
      '',
    ].join('\n')
  );
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'suffixless-secret');
  });
});

test('properties: new-style suffix-less key `apollo.access-key.secret` is accepted', () => {
  const propsFile = writeTempProperties('apollo.access-key.secret=newstyle-secret\n');
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'newstyle-secret');
  });
});

test('properties duplicate keys use the last value', () => {
  const propsFile = writeTempProperties(
    'apollo.accesskey.secret=first-secret\napollo.accesskey.secret=second-secret\n'
  );
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'second-secret');
  });
});

test('properties: per-env keys win over suffix-less keys, per env (AC-5c dev/prod)', () => {
  const propsFile = writeTempProperties(
    [
      'apollo.accesskey.secret.dev=dev-secret-aaaaaaaa',
      'apollo.accesskey.secret.prod=prod-secret-bbbbbbbb',
      'apollo.accesskey.secret=fallback-secret',
    ].join('\n')
  );
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ env: 'dev', propertiesPath: propsFile }), 'dev-secret-aaaaaaaa');
    assert.strictEqual(resolveAccessKeySecret({ env: 'prod', propertiesPath: propsFile }), 'prod-secret-bbbbbbbb');
  });
});

test('properties: env=test without a matching suffix key falls back to suffix-less', () => {
  const propsFile = writeTempProperties('apollo.accesskey.secret=fallback-secret\n');
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ env: 'test', propertiesPath: propsFile }), 'fallback-secret');
  });
});

test('properties: `env` option takes precedence over APOLLO_ENV', () => {
  const propsFile = writeTempProperties(
    [
      'apollo.accesskey.secret.dev=dev-from-option',
      'apollo.accesskey.secret.prod=prod-from-apollo-env',
    ].join('\n')
  );
  withEnv({ APOLLO_ENV: 'prod' }, () => {
    assert.strictEqual(
      resolveAccessKeySecret({ env: 'dev', propertiesPath: propsFile }),
      'dev-from-option'
    );
  });
});

test('properties: APOLLO_ENV supplies the env when the option is absent', () => {
  const propsFile = writeTempProperties('apollo.accesskey.secret.prod=prod-from-apollo-env\n');
  withEnv({ APOLLO_ENV: 'prod' }, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), 'prod-from-apollo-env');
  });
});

test('every layer empty -> undefined (no secret, unsigned mode)', () => {
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), undefined);
    assert.strictEqual(resolveAccessKeySecret(), undefined);
  });
});

test('missing properties file does not throw (treated as empty)', () => {
  withEnv({}, () => {
    assert.doesNotThrow(() => resolveAccessKeySecret({ propertiesPath: MISSING_FILE }));
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: MISSING_FILE }), undefined);
  });
});

test('blank property values do not satisfy a layer (fall through / undefined)', () => {
  const propsFile = writeTempProperties('apollo.accesskey.secret=   \n');
  withEnv({}, () => {
    assert.strictEqual(resolveAccessKeySecret({ propertiesPath: propsFile }), undefined);
  });
});

test('parseKeyValueText: BOM stripping, comments, `:` separator, trimming', () => {
  const parsed = parseKeyValueText('\uFEFF# a comment\n! another comment\n\nkey1 = value1 \nkey2:colon-value\n');
  assert.deepStrictEqual(parsed, { key1: 'value1', key2: 'colon-value' });
});

test('parseKeyValueText: lines without a separator or with an empty key are ignored', () => {
  const parsed = parseKeyValueText('noseparator\n=emptykey\n  =  \nvalid=1\n');
  assert.deepStrictEqual(parsed, { valid: '1' });
});

test('parseKeyValueText: duplicate keys use the last value and special keys stay own data properties', () => {
  const parsed = parseKeyValueText(
    ['DUPLICATE=first', 'DUPLICATE=second', '__proto__=safe', 'constructor=ctor', 'toString=text'].join('\n')
  );
  assert.strictEqual(parsed.DUPLICATE, 'second');
  assert.strictEqual(Object.getPrototypeOf(parsed), Object.prototype);
  for (const [key, value] of [
    ['__proto__', 'safe'],
    ['constructor', 'ctor'],
    ['toString', 'text'],
  ]) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed, key), true);
    assert.strictEqual(Object.getOwnPropertyDescriptor(parsed, key).value, value);
  }
});

test('parseKeyValueText is not a public index export but is available via dist/secret.js', () => {
  const publicSurface = require('../dist/index.js');
  assert.strictEqual(publicSurface.parseKeyValueText, undefined);
  assert.strictEqual(typeof parseKeyValueText, 'function');
  assert.deepStrictEqual(parseKeyValueText('a=1'), { a: '1' });
});
