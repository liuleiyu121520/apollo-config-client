/**
 * Apollo accesskey signature implementation.
 *
 * DERIVATION NOTICE (Apache-2.0 protocol basis, MIT upstream source):
 * - Upstream: @lvgithub/ctrip-apollo-client@1.0.38, MIT license,
 *   Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors,
 *   https://github.com/lvgithub/ctrip-apollo-client
 *   (src/index.js:395-436: genAuthHeaders / genSignature /
 *   url2PathWithQuery). Reused technique: crypto.createHmac('sha1'),
 *   the `${timestamp}\n${pathWithQuery}` signing string, base64 digest
 *   and `new URL` based path/query extraction. Full license text is
 *   preserved in THIRD-PARTY-NOTICES.md section 2.
 * - Function boundaries follow the Apollo Java client 2.4.0
 *   `com.ctrip.framework.apollo.core.signature.Signature`
 *   (signature / buildHttpHeaders / url2PathWithQuery as separate
 *   functions; `Authorization: Apollo {appId}:{signature}` format,
 *   `\n` delimiter, millisecond `Timestamp` header).
 * - Validated against the Apollo Java client 2.4.0 protocol test
 *   vectors (see test/signature.test.js):
 *   signature = base64(HmacSHA1(secret, `${timestamp}\n${pathWithQuery}`)),
 *   both inputs UTF-8 encoded.
 */

import { createHmac } from 'node:crypto';

/**
 * Compute the Apollo accesskey signature:
 * `base64(HmacSHA1(secret, timestamp + "\n" + pathWithQuery))`
 * with UTF-8 encoding of both the key and the signing string.
 *
 * @param timestamp - current time as a millisecond epoch string.
 * @param pathWithQuery - URL path plus, when non-empty, `?` + query.
 * @param secret - the access key secret.
 * @returns the base64-encoded signature.
 */
export function signature(timestamp: string, pathWithQuery: string, secret: string): string {
  const stringToSign = `${timestamp}\n${pathWithQuery}`;
  return createHmac('sha1', secret).update(stringToSign, 'utf8').digest('base64');
}

/**
 * Build the signature request headers for one request URL, aligned with
 * the Java client `Signature.buildHttpHeaders`:
 * - `Authorization: Apollo {appId}:{signature}`
 * - `Timestamp: {millisecond epoch string}`
 *
 * Callers MUST pass a non-empty secret (the client layer skips signing
 * entirely when no secret resolves, mirroring the Java
 * RemoteConfigRepository behavior of signing only when a secret exists).
 *
 * @param url - the absolute request URL that will be sent.
 * @param appId - the Apollo appId.
 * @param secret - the access key secret.
 */
export function buildHttpHeaders(
  url: string,
  appId: string,
  secret: string
): { Authorization: string; Timestamp: string } {
  const timestamp: string = String(Date.now());
  const pathWithQuery: string = url2PathWithQuery(url);
  const sig: string = signature(timestamp, pathWithQuery, secret);
  return {
    Authorization: `Apollo ${appId}:${sig}`,
    Timestamp: timestamp,
  };
}

/**
 * Extract `path` plus (when a non-empty query exists) `?` + query from
 * an absolute URL, matching Java `Signature.url2PathWithQuery`:
 * `/configs/app/cluster/ns?releaseKey=...&ip=...`.
 * The raw (already percent-encoded) query string is preserved as-is.
 *
 * @param url - absolute URL string.
 * @returns the pathWithQuery part used in the signing string.
 */
export function url2PathWithQuery(url: string): string {
  const parsed = new URL(url);
  const path: string = parsed.pathname;
  const query: string = parsed.search;
  if (query.length > 0) {
    return `${path}${query}`;
  }
  return path;
}
