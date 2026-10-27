'use strict';

/**
 * Package artifact audit (PRD AC-10 / AC-11 / AC-13 / AC-14 / AC-18 /
 * AC-21, PLAN §7.4 final acceptance).
 *
 * NOTE: this file is an addition to the PLAN §4.3 test-file list; it
 * exists because the audit items (npm pack whitelist, secret/leak scan,
 * README attribution checks, license preservation, zero runtime
 * dependencies) were mandated as must-test but had no carrier file in
 * the plan.
 *
 * v1.0: the whitelist is 29 files (four mechanism dist modules:
 * watch / discovery / cache / local-ip, each as .js + .d.ts, plus the
 * shared url util module), the
 * version is asserted as 1.0.0, `npm ls --omit=dev` must stay empty
 * (AC-18), THIRD-PARTY-NOTICES must carry the five-mechanism reuse
 * scope (AC-21) and both READMEs must document the new sections.
 *
 * The audit runs `npm pack --dry-run --json` in the package root. It is
 * launched through `npm test` (which injects `npm_execpath` and
 * `npm_node_execpath`); when those are missing it falls back to the
 * npm-cli.js co-located with the running Node installation.
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');

const EXPECTED_PACK_FILES = [
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'THIRD-PARTY-NOTICES.md',
  'dist/cache.d.ts',
  'dist/cache.js',
  'dist/client.d.ts',
  'dist/client.js',
  'dist/compat.d.ts',
  'dist/compat.js',
  'dist/discovery.d.ts',
  'dist/discovery.js',
  'dist/errors.d.ts',
  'dist/errors.js',
  'dist/http.d.ts',
  'dist/http.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/local-ip.d.ts',
  'dist/local-ip.js',
  'dist/secret.d.ts',
  'dist/secret.js',
  'dist/signature.d.ts',
  'dist/signature.js',
  'dist/url.d.ts',
  'dist/url.js',
  'dist/watch.d.ts',
  'dist/watch.js',
  'package.json',
].sort();

function resolveNpmCli() {
  if (process.env.npm_execpath && process.env.npm_node_execpath) {
    return { node: process.env.npm_node_execpath, cli: process.env.npm_execpath };
  }
  // Fallback for a direct `node --test` invocation: the npm-cli.js that
  // ships next to the current Node binary.
  const candidate = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(candidate)) {
    return { node: process.execPath, cli: candidate };
  }
  return null;
}

function readPackManifest() {
  const npm = resolveNpmCli();
  assert.ok(npm, 'npm-cli.js not resolvable for the pack audit');
  const stdout = execFileSync(npm.node, [npm.cli, 'pack', '--dry-run', '--json'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return entry.files.map((f) => f.path).sort();
}

test('AC-10: automated suite runs on Node >= 22', () => {
  const major = Number(process.version.slice(1).split('.')[0]);
  assert.ok(major >= 22, `expected Node >= 22, got ${process.version}`);
});

test('AC-11/AC-14: npm pack contains exactly the 29 whitelisted files (v1.0)', () => {
  const packed = readPackManifest();
  assert.deepStrictEqual(packed, EXPECTED_PACK_FILES);
  assert.strictEqual(packed.length, 29);
});

test('AC-11/AC-14: the pack contains no source/test/reference/docs leakage', () => {
  const packed = readPackManifest();
  for (const file of packed) {
    assert.ok(!file.startsWith('src/'), `src/ must not ship: ${file}`);
    assert.ok(!file.startsWith('test/'), `test/ must not ship: ${file}`);
    assert.ok(!file.startsWith('reference/'), `reference/ must not ship: ${file}`);
    assert.ok(!file.startsWith('docs/'), `docs/ must not ship: ${file}`);
  }
});

test('AC-11: published files contain no real secrets or internal domains', () => {
  const packed = readPackManifest();
  // QA canary markers and internal domains must never appear anywhere in
  // the package; the compiled dist must not embed even the public
  // documentation example secret.
  const forbiddenEverywhere = ['fang.com', 'TOPSECRET-QA-CANARY', '另一个测试密钥'];
  for (const relPath of packed) {
    const content = fs.readFileSync(path.join(PKG_ROOT, relPath), 'utf8');
    for (const marker of forbiddenEverywhere) {
      assert.ok(!content.includes(marker), `${relPath} contains forbidden marker ${marker}`);
    }
    if (relPath.startsWith('dist/')) {
      assert.ok(
        !content.includes('test-secret-0123456789abcdef'),
        `${relPath} must not embed the doc example secret`
      );
    }
  }
});

test('AC-13: both READMEs carry the three attribution elements', () => {
  const required = [
    // 1) node-apollo base: ISC, author email, upstream repository.
    ['node-apollo', 'ISC', 'Quinton.xu@gmail.com', 'code.aliyun.com/ecarx-web/node-apollo'],
    // 2) signature source: @lvgithub/ctrip-apollo-client, MIT, repository.
    ['@lvgithub/ctrip-apollo-client', 'MIT', 'github.com/lvgithub/ctrip-apollo-client'],
    // 3) protocol basis: Apollo Java client 2.4.0.
    ['2.4.0', 'Java'],
  ];
  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const content = fs.readFileSync(path.join(PKG_ROOT, readme), 'utf8');
    for (const group of required) {
      for (const fragment of group) {
        assert.ok(content.includes(fragment), `${readme} missing attribution fragment "${fragment}"`);
      }
    }
    // Link to the third-party notices file.
    assert.ok(content.includes('THIRD-PARTY-NOTICES.md'), `${readme} must link THIRD-PARTY-NOTICES.md`);
  }
});

test('AC-14: THIRD-PARTY-NOTICES.md preserves both upstream license texts with copyright lines', () => {
  const content = fs.readFileSync(path.join(PKG_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  // ISC (node-apollo, text completed from its package.json declaration).
  assert.ok(content.includes('Copyright (c) 2018 Quinton.xu <Quinton.xu@gmail.com>'));
  assert.ok(content.includes('Permission to use, copy, modify, and/or distribute this software for any'));
  assert.ok(content.includes('node-apollo@1.2.1'));
  // MIT (@lvgithub/ctrip-apollo-client, verbatim upstream LICENSE).
  assert.ok(content.includes('Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors'));
  assert.ok(content.includes('Permission is hereby granted, free of charge, to any person obtaining'));
  assert.ok(content.includes('@lvgithub/ctrip-apollo-client@1.0.38'));
  // Protocol basis section.
  assert.ok(content.includes('2.4.0'));
  assert.ok(content.includes('Apache'));
});

test('AC-11/AC-14: package LICENSE is the package MIT text with its own copyright line', () => {
  const content = fs.readFileSync(path.join(PKG_ROOT, 'LICENSE'), 'utf8');
  assert.ok(content.includes('MIT License'));
  assert.ok(content.includes('Copyright (c) 2026 liuleiyu'));
  // MIT compatibility markers present (permission grant wording).
  assert.ok(content.includes('Permission is hereby granted, free of charge'));
});

test('AC-11: package.json metadata is complete and dependency-free at runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, 'apollo-config-client');
  assert.strictEqual(pkg.version, '1.0.0');
  assert.strictEqual(pkg.license, 'MIT');
  assert.strictEqual(pkg.main, 'dist/index.js');
  assert.strictEqual(pkg.types, 'dist/index.d.ts');
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes('THIRD-PARTY-NOTICES.md'));
  assert.ok(typeof pkg.engines.node === 'string');
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'zero runtime dependencies');
  assert.ok(pkg.description && pkg.repository && Array.isArray(pkg.keywords));
});

test('AC-18: zero runtime dependency tree (`npm ls --omit=dev` is empty)', () => {
  const npm = resolveNpmCli();
  assert.ok(npm, 'npm-cli.js not resolvable for the dependency audit');
  let stdout = '';
  try {
    stdout = execFileSync(npm.node, [npm.cli, 'ls', '--omit=dev', '--all', '--json'], {
      cwd: PKG_ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
  } catch (err) {
    // npm ls exits non-zero when the tree is NOT empty; an empty tree
    // exits 0. Treat a non-zero exit as a failure with the output kept.
    assert.fail(`npm ls --omit=dev reported dependencies: ${err.stdout || err.message}`);
  }
  const tree = JSON.parse(stdout);
  // npm omits the `dependencies` key entirely for an empty tree.
  assert.ok(
    !tree.dependencies || Object.keys(tree.dependencies).length === 0,
    'no runtime dependencies allowed'
  );
});

test('AC-21: THIRD-PARTY-NOTICES reuse scope covers all five v1.0 mechanisms', () => {
  const content = fs.readFileSync(path.join(PKG_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  // Every mechanism module must be named with its upstream line refs.
  assert.ok(content.includes('src/watch.ts'), 'NOTICES must name the long-polling module');
  assert.ok(content.includes('src/cache.ts'), 'NOTICES must name the local-cache module');
  assert.ok(content.includes('src/local-ip.ts'), 'NOTICES must name the local-IP module');
  assert.ok(content.includes('src/discovery.ts'), 'NOTICES must name the discovery module');
  assert.ok(content.includes('src/index.js:76-247'), 'long-polling upstream line refs');
  assert.ok(content.includes(':249-295'), 'local-file-cache upstream line refs');
  assert.ok(content.includes(':66-69'), 'local IP attachment upstream line refs');
  assert.ok(content.includes(':99-114'), 'meta discovery refresh upstream line refs');
  // The change-callback mechanism is part of the polling scope.
  assert.ok(content.includes('notificationId') || content.includes('notification'));
});

test('AC-12/AC-21: both READMEs document the five v1.0 mechanism sections', () => {
  const enFragments = [
    'Long polling', // watcher section
    'Local cache',
    'Grayscale IP',
    'Meta service discovery',
    'Multiple instances',
    '@lvgithub/ctrip-apollo-client', // migration/acknowledgement coverage
  ];
  const zhFragments = [
    '长轮询',
    '本地缓存',
    '灰度 IP',
    'meta 服务发现',
    '多实例',
    '@lvgithub/ctrip-apollo-client',
  ];
  const en = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
  for (const fragment of enFragments) {
    assert.ok(en.includes(fragment), `README.md missing v1.0 section fragment "${fragment}"`);
  }
  const zh = fs.readFileSync(path.join(PKG_ROOT, 'README.zh-CN.md'), 'utf8');
  for (const fragment of zhFragments) {
    assert.ok(zh.includes(fragment), `README.zh-CN.md missing v1.0 section fragment "${fragment}"`);
  }
});
