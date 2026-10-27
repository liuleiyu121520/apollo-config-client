'use strict';

/**
 * Signature protocol tests (PRD AC-1 / AC-2, PLAN §7.1).
 *
 * The expected vectors below come from PLAN §7.1 and were independently
 * recomputed here with Node crypto before being asserted against the
 * implementation under test (`dist/signature.js`).
 */

const test = require('node:test');
const assert = require('node:assert');

const { signature, buildHttpHeaders, url2PathWithQuery } = require('../dist/index.js');

const SECRET = 'test-secret-0123456789abcdef';
const APP_ID = 'sample-app';

// PLAN §7.1 fixed protocol vectors (AC-1).
const VECTORS = [
  {
    id: 'V1 (with query)',
    secret: SECRET,
    timestamp: '1700000000000',
    pathWithQuery: '/configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1',
    expected: 'dz4F7eaG+5I5PiWjETCC4+HcLjM=',
  },
  {
    id: 'V2 (without query)',
    secret: SECRET,
    timestamp: '1600000000000',
    pathWithQuery: '/configfiles/json/sample-app/default/application',
    expected: 'iBbnumrUzaeIEYLtN8Q5TXrwVLk=',
  },
  {
    id: 'V3 (UTF-8 Chinese namespace)',
    secret: '另一个测试密钥',
    timestamp: '1700000000001',
    pathWithQuery: '/configs/sample-app/default/公共命名空间',
    expected: 'eXYm5jYcRVaf1X8+9TQZO+ROZqI=',
  },
];

test('signature() matches the fixed Java protocol vectors (AC-1)', () => {
  for (const v of VECTORS) {
    assert.strictEqual(
      signature(v.timestamp, v.pathWithQuery, v.secret),
      v.expected,
      `${v.id}: signature mismatch`
    );
  }
});

test('signature() is deterministic and changes with each input field', () => {
  const v = VECTORS[0];
  const base = signature(v.timestamp, v.pathWithQuery, v.secret);
  assert.strictEqual(signature(v.timestamp, v.pathWithQuery, v.secret), base);
  assert.notStrictEqual(signature('1700000000001', v.pathWithQuery, v.secret), base);
  assert.notStrictEqual(signature(v.timestamp, v.pathWithQuery + 'x', v.secret), base);
  assert.notStrictEqual(signature(v.timestamp, v.pathWithQuery, v.secret + 'x'), base);
});

test('url2PathWithQuery: with a query it is path + "?" + raw query (AC-2)', () => {
  const url =
    'http://apollo.example.com/configs/sample-app/default/application' +
    '?releaseKey=20261026150000-abc&ip=10.0.0.1';
  assert.strictEqual(
    url2PathWithQuery(url),
    '/configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1'
  );
});

test('url2PathWithQuery: without a query it is just the path (AC-2)', () => {
  assert.strictEqual(
    url2PathWithQuery('http://apollo.example.com/configfiles/json/sample-app/default/application'),
    '/configfiles/json/sample-app/default/application'
  );
});

test('url2PathWithQuery preserves the raw (already encoded) query text', () => {
  // The signing string must use the encoded on-the-wire query, never a
  // decoded variant (Java parity; the mock server verifies this E2E).
  const url = 'http://apollo.example.com/configs/a/default/x?ip=10.0.0.1&label=a%20b%2Bc';
  assert.strictEqual(url2PathWithQuery(url), '/configs/a/default/x?ip=10.0.0.1&label=a%20b%2Bc');
});

test('url2PathWithQuery keeps percent-encoded UTF-8 path segments encoded', () => {
  const encoded = encodeURIComponent('公共命名空间');
  const url = `http://apollo.example.com/configs/sample-app/default/${encoded}`;
  assert.strictEqual(
    url2PathWithQuery(url),
    `/configs/sample-app/default/${encoded}`
  );
});

test('buildHttpHeaders: Authorization is "Apollo {appId}:{signature}" and Timestamp is 13 digits (AC-1)', () => {
  const url = 'http://apollo.example.com/configs/sample-app/default/application';
  const headers = buildHttpHeaders(url, APP_ID, SECRET);
  assert.match(headers.Authorization, new RegExp(`^Apollo ${APP_ID}:[A-Za-z0-9+/=]+$`));
  assert.match(headers.Timestamp, /^\d{13}$/);
  // Recomputing the signature with the header's own timestamp must
  // reproduce the exact vector math.
  const pathWithQuery = url2PathWithQuery(url);
  assert.strictEqual(
    headers.Authorization,
    `Apollo ${APP_ID}:${signature(headers.Timestamp, pathWithQuery, SECRET)}`
  );
});

test('buildHttpHeaders signs the path-with-query of the given URL (both endpoints)', () => {
  for (const url of [
    'http://apollo.example.com/configs/a/default/ns1?releaseKey=rk&ip=10.0.0.1',
    'http://apollo.example.com/configfiles/json/a/default/ns1?ip=10.0.0.1',
  ]) {
    const headers = buildHttpHeaders(url, APP_ID, SECRET);
    const sig = signature(headers.Timestamp, url2PathWithQuery(url), SECRET);
    assert.strictEqual(headers.Authorization, `Apollo ${APP_ID}:${sig}`);
  }
});

test('Timestamp is a millisecond epoch string (13 digits) across calls', () => {
  for (let i = 0; i < 3; i++) {
    const headers = buildHttpHeaders('http://apollo.example.com/configs/a/default/ns', APP_ID, SECRET);
    assert.match(headers.Timestamp, /^\d{13}$/);
    const asNumber = Number(headers.Timestamp);
    // Millisecond epoch: within 24h of the test run time.
    assert.ok(Math.abs(Date.now() - asNumber) < 24 * 60 * 60 * 1000);
  }
});
