'use strict';

/**
 * Local Apollo mock server for the apollo-config-client test suite.
 *
 * v1.0 responsibilities (unchanged):
 * - 200 responses in both wire shapes (`/configs/...` ApolloConfig JSON,
 *   `/configfiles/json/...` flat JSON) plus the OpenApi `/openapi/v1/...`
 *   shape; 304 / 401 / 404 / delayed responses through `setBehavior`;
 * - raw `req.url` + header recording for URL and signature assertions;
 * - signature verification mode recomputing the Java formula over the
 *   raw request URL (`Timestamp` header + raw `req.url`).
 *
 * v1.1 additions (plan §7.1):
 * - `/notifications/v2` branch: signed long-poll endpoint (default 304);
 *   per-request decisions can hold the connection (`holdMs`, server-side
 *   hold simulation) and then answer 304 or a 200 change payload; the
 *   notifications query parameter is decodable through
 *   `parseNotificationsQuery`;
 * - `/services/config` branch: unsigned meta discovery endpoint with an
 *   A/B programmable response sequence (`setServiceSequence`);
 * - decision extensions: `holdMs` (delayed respond) and
 *   `dropConnection` (destroy the socket without responding);
 * - `abortedRequests` counter: requests whose socket closed before the
 *   response finished (client-side aborts / connection drops), so tests
 *   can prove that `stop()` really tears down in-flight requests;
 * - `stubNetworkInterfaces(table)`: the shared deterministic
 *   `os.networkInterfaces` fixture (lo internal 127.0.0.1 + eth0
 *   192.0.2.10 + an IPv6 entry) used by the default-carries-IP
 *   assertions of client/equivalence/drop-in and by the local-ip tests.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');

/** Reference implementation of the Java signing formula (test oracle). */
function computeApolloSignature(secret, timestamp, pathWithQuery) {
  return crypto
    .createHmac('sha1', secret)
    .update(`${timestamp}\n${pathWithQuery}`, 'utf8')
    .digest('base64');
}

/** The fixed interface table shared by every ip-determinism assertion. */
const FIXED_INTERFACES = {
  lo: [
    { internal: true, family: 'IPv4', address: '127.0.0.1' },
    { internal: true, family: 'IPv6', address: '::1' },
  ],
  eth0: [
    { internal: false, family: 'IPv6', address: 'fe80::1' },
    { internal: false, family: 'IPv4', address: '192.0.2.10' },
  ],
  eth1: [{ internal: false, family: 'IPv4', address: '10.9.8.7' }],
};

/**
 * Replace `os.networkInterfaces` with a deterministic table. Returns a
 * restore function (save/restore is the caller's duty). The compiled
 * dist accesses `require('node:os').networkInterfaces` as a property at
 * call time, so this patch is observed by dist code.
 */
function stubNetworkInterfaces(table) {
  const saved = os.networkInterfaces;
  os.networkInterfaces = () => (table === undefined ? FIXED_INTERFACES : table);
  return () => {
    os.networkInterfaces = saved;
  };
}

/**
 * Decode the `notifications` query parameter of a `/notifications/v2`
 * URL into `[{namespaceName, notificationId}]`.
 */
function parseNotificationsQuery(rawUrl) {
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex < 0) {
    return [];
  }
  for (const pair of rawUrl.slice(queryIndex + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) {
      continue;
    }
    if (pair.slice(0, eq) === 'notifications') {
      try {
        return JSON.parse(decodeURIComponent(pair.slice(eq + 1)));
      } catch {
        return [];
      }
    }
  }
  return [];
}

/**
 * Create and start a mock Apollo server on 127.0.0.1 with an ephemeral
 * port. Resolves with a handle:
 * `{ server, port, baseURL, requests, requestsTo, setBehavior,
 *    resetBehavior, setServiceSequence, abortedRequests, close }`.
 *
 * `close()` closes the server and forcibly destroys lingering
 * keep-alive sockets so `node --test` processes exit promptly.
 */
function createApolloMockServer(options = {}) {
  const verifySecret = options.verifySecret || null;
  const requireSignature = options.requireSignature === true;
  const requests = [];
  let behavior = null;
  /** A/B programmable raw bodies for `/services/config`; last repeats. */
  let serviceSequence = null;
  let serviceCursor = 0;
  /** Requests whose socket closed before the response finished. */
  let abortedRequests = 0;
  /** Pending hold/drop timers; all cleared on close() so the test
   *  process never waits for a simulated server hold to elapse. */
  const pendingTimers = new Set();

  /** Schedule fn after `delay` ms, tracked for close()-time cleanup. */
  function schedule(fn, delay) {
    if (delay > 0) {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        fn();
      }, delay);
      pendingTimers.add(timer);
    } else {
      fn();
    }
  }

  const server = http.createServer((req, res) => {
    // A timed-out or aborted client may destroy the socket mid-response;
    // never let late writes crash the test process.
    res.on('error', () => {});
    res.on('close', () => {
      if (!res.writableEnded) {
        abortedRequests += 1;
      }
    });
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const record = {
        method: req.method,
        // Raw path + query exactly as received (percent-encoding kept).
        url: req.url,
        headers: Object.assign({}, req.headers),
      };
      requests.push(record);

      let decision = null;
      if (typeof behavior === 'function') {
        decision = behavior(record) || null;
      }
      if (!decision) {
        decision = defaultDecide(record.url);
      }

      if (verifySecret) {
        const verdict = verifySignatureHeaders(record, verifySecret);
        if (verdict === 'bad') {
          decision = { status: 401, body: '' };
        } else if (verdict === 'missing' && requireSignature) {
          decision = { status: 401, body: '' };
        }
      }

      const respond = () => {
        res.writeHead(decision.status, {
          'Content-Type': decision.contentType || 'application/json;charset=UTF-8',
        });
        res.end(decision.body == null ? '' : String(decision.body));
      };
      // `holdMs` is the v1.1 name (server-side hold simulation);
      // `delayMs` stays supported for the v1.0 timeout/failure tests.
      const delay = decision.holdMs > 0 ? decision.holdMs : decision.delayMs || 0;
      if (decision.dropConnection) {
        schedule(() => res.socket.destroy(), delay);
        return;
      }
      schedule(respond, delay);
    });
  });

  /** Verify `Authorization: Apollo appId:sig` against Timestamp + raw URL. */
  function verifySignatureHeaders(record, secret) {
    const auth = record.headers.authorization;
    const timestamp = record.headers.timestamp;
    if (typeof auth !== 'string' || !auth.startsWith('Apollo ')) {
      return 'missing';
    }
    const match = /^Apollo ([^:]+):(.*)$/.exec(auth);
    if (!match) {
      return 'bad';
    }
    if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp)) {
      return 'bad';
    }
    const expected = computeApolloSignature(secret, timestamp, record.url);
    return match[2] === expected ? 'ok' : 'bad';
  }

  /** Default handler: wire-shape-faithful responses for all endpoints. */
  function defaultDecide(url) {
    if (url.startsWith('/notifications/v2')) {
      // Nothing changed: the safe default for a long poll.
      return { status: 304, body: '' };
    }
    if (url.startsWith('/services/config')) {
      if (serviceSequence !== null && serviceSequence.length > 0) {
        const body = serviceSequence[Math.min(serviceCursor, serviceSequence.length - 1)];
        serviceCursor += 1;
        return { status: 200, body };
      }
      return {
        status: 200,
        body: JSON.stringify([{ homepageUrl: `http://127.0.0.1:${server.address().port}` }]),
      };
    }
    if (url.startsWith('/configs/')) {
      const rest = url.slice('/configs/'.length).split('?')[0];
      const parts = rest.split('/').map(decodeURIComponent);
      const ns = parts[2] || 'application';
      return {
        status: 200,
        body: JSON.stringify({
          appId: parts[0],
          cluster: parts[1],
          namespaceName: ns,
          releaseKey: 'mock-release-key',
          configurations: { [`${ns}.k1`]: `${ns}-v1`, shared: ns },
        }),
      };
    }
    if (url.startsWith('/configfiles/json/')) {
      const rest = url.slice('/configfiles/json/'.length).split('?')[0];
      const parts = rest.split('/').map(decodeURIComponent);
      const ns = parts[2] || 'application';
      return {
        status: 200,
        body: JSON.stringify({ [`${ns}.k1`]: `${ns}-v1`, shared: ns }),
      };
    }
    if (url.startsWith('/openapi/v1/')) {
      return {
        status: 200,
        body: JSON.stringify([
          {
            isPublic: true,
            items: [
              { key: 'pub.key', value: 'pub-value' },
              { key: 'json.key', value: '{"nested":1}' },
            ],
          },
          {
            isPublic: false,
            items: [
              { key: 'priv.key', value: 'priv-value' },
              { key: 'plain.key', value: 'just a string' },
            ],
          },
        ]),
      };
    }
    return { status: 404, body: 'mock: unhandled path' };
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseURL: `http://127.0.0.1:${port}`,
        requests,
        /** All recorded requests whose raw URL starts with `prefix`. */
        requestsTo(prefix) {
          return requests.filter((r) => r.url.startsWith(prefix));
        },
        setBehavior(fn) {
          behavior = fn;
        },
        resetBehavior() {
          behavior = null;
        },
        /**
         * Program the `/services/config` response sequence: each
         * discovery request consumes the next raw JSON body; once
         * exhausted, the last body repeats (A -> B switching support).
         */
        setServiceSequence(bodies) {
          serviceSequence = bodies;
          serviceCursor = 0;
        },
        /** Count of connections dropped before the response finished. */
        get abortedRequests() {
          return abortedRequests;
        },
        close() {
          return new Promise((done) => {
            // Cancel every pending hold/drop timer first: a simulated
            // server hold (e.g. holdMs 30000) must not keep the event
            // loop alive after the test finished.
            for (const timer of pendingTimers) {
              clearTimeout(timer);
            }
            pendingTimers.clear();
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
            server.close(() => done());
          });
        },
      });
    });
  });
}

module.exports = {
  createApolloMockServer,
  computeApolloSignature,
  parseNotificationsQuery,
  stubNetworkInterfaces,
  FIXED_INTERFACES,
};
