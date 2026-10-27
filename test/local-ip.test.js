'use strict';

/**
 * Local IPv4 auto-detection tests (PRD AC-18, PLAN §7.3 cache/
 * discovery/local-ip group).
 *
 * Covers: first non-internal IPv4 wins (internal + IPv6 entries are
 * skipped), no module-level memo (two consecutive calls with different
 * stubbed tables both take effect), enumeration failures return
 * `undefined` without throwing, and the real-machine smoke (returns a
 * string or undefined, never throws).
 */

const test = require('node:test');
const assert = require('node:assert');

const { detectLocalIpv4 } = require('../dist/index.js');
const { stubNetworkInterfaces, FIXED_INTERFACES } = require('./helpers/mock-server.js');

test('detectLocalIpv4: first non-internal IPv4 wins (internal and IPv6 skipped)', () => {
  const restore = stubNetworkInterfaces();
  try {
    assert.strictEqual(detectLocalIpv4(), '192.0.2.10');
  } finally {
    restore();
  }
});

test('detectLocalIpv4: interface iteration order follows the table key order (no sorting)', () => {
  // eth1 is listed first, so its address wins even though eth0 sorts
  // earlier alphabetically — detection enumerates in OS/key order and
  // takes the first non-internal IPv4.
  const table = {
    lo: FIXED_INTERFACES.lo,
    eth1: [{ internal: false, family: 'IPv4', address: '10.9.8.7' }],
    eth0: [{ internal: false, family: 'IPv4', address: '192.0.2.10' }],
  };
  const restore = stubNetworkInterfaces(table);
  try {
    assert.strictEqual(detectLocalIpv4(), '10.9.8.7');
  } finally {
    restore();
  }
});

test('detectLocalIpv4: no module-level memo — two consecutive stub switches both take effect', () => {
  const restore = stubNetworkInterfaces({ ethA: [{ internal: false, family: 'IPv4', address: '10.0.0.1' }] });
  try {
    assert.strictEqual(detectLocalIpv4(), '10.0.0.1');
    // Switch the table in place WITHOUT restoring: a memoized
    // implementation would still return the first value.
    const second = stubNetworkInterfaces({ ethB: [{ internal: false, family: 'IPv4', address: '10.0.0.2' }] });
    try {
      assert.strictEqual(detectLocalIpv4(), '10.0.0.2', 'second call must re-enumerate');
      assert.strictEqual(detectLocalIpv4(), '10.0.0.2', 'and again');
    } finally {
      second();
    }
    // And back: every call reflects the current interfaces.
    assert.strictEqual(detectLocalIpv4(), '10.0.0.1');
  } finally {
    restore();
  }
});

test('detectLocalIpv4: only-internal table yields undefined', () => {
  const restore = stubNetworkInterfaces({ lo: FIXED_INTERFACES.lo });
  try {
    assert.strictEqual(detectLocalIpv4(), undefined);
  } finally {
    restore();
  }
});

test('detectLocalIpv4: empty table yields undefined', () => {
  const restore = stubNetworkInterfaces({});
  try {
    assert.strictEqual(detectLocalIpv4(), undefined);
  } finally {
    restore();
  }
});

test('detectLocalIpv4: enumeration failure yields undefined (never throws)', () => {
  const restore = stubNetworkInterfaces();
  // Break the function itself to simulate an os-level failure.
  os_networkInterfaces_replace(() => {
    throw new Error('boom');
  });
  try {
    assert.doesNotThrow(() => detectLocalIpv4());
    assert.strictEqual(detectLocalIpv4(), undefined);
  } finally {
    os_networkInterfaces_replace(() => FIXED_INTERFACES);
    restore();
  }
});

test('detectLocalIpv4: malformed entry shapes are tolerated', () => {
  const table = {
    broken: null, // not an array -> skipped
    weird: [{ internal: false, family: 'IPv4' }], // no address -> skipped
    ipv6only: [{ internal: false, family: 'IPv6', address: 'fd00::1' }],
    good: [{ internal: false, family: 'IPv4', address: '172.16.0.9' }],
  };
  const restore = stubNetworkInterfaces(table);
  try {
    assert.strictEqual(detectLocalIpv4(), '172.16.0.9');
  } finally {
    restore();
  }
});

test('detectLocalIpv4: real-machine smoke — string or undefined, never throws', () => {
  assert.doesNotThrow(() => {
    const ip = detectLocalIpv4();
    assert.ok(ip === undefined || (typeof ip === 'string' && ip.length > 0));
  });
});

/** Direct swap helper for the failure-injection test above. */
function os_networkInterfaces_replace(fn) {
  const os = require('node:os');
  os.networkInterfaces = fn;
}
