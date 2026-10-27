/**
 * Minimal Promise-based HTTP request layer built on node:http /
 * node:https.
 *
 * No upstream source: new capability that replaces the base package's
 * urllib@^2 dependency (zero runtime dependencies, see README). The
 * layer returns raw responses ({statusCode, headers, body}) without
 * following redirects; status/304/JSON semantics are handled by
 * client.ts.
 *
 * Notes:
 * - TLS certificate verification stays at the Node default (verified).
 *   The base package disabled verification via urllib's
 *   `rejectUnauthorized: false`; see README behavioral differences.
 * - `timeoutMs` (default 5000) destroys the socket when the request
 *   does not finish in time, so a scheduler cycle can never hang.
 * - v1.1 (long-polling support): every entry point accepts an optional
 *   `AbortSignal`. An aborted signal destroys the in-flight request
 *   immediately and rejects with `ApolloNetworkError` (the abort
 *   reason, when it is an Error, is referenced in the message), so the
 *   watcher can cancel pending long polls / refetches / discovery
 *   requests in one shot. Without a signal the behavior is byte-for-byte
 *   the v1.0 behavior.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { ApolloNetworkError } from './errors';

export interface HttpRequestBodyOptions {
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds; defaults to 5000. */
  timeoutMs?: number;
  /**
   * Optional abort signal (v1.1). When it fires, the in-flight request
   * is destroyed and the promise rejects with `ApolloNetworkError`.
   * A signal that is already aborted rejects immediately.
   */
  signal?: AbortSignal;
}

export interface HttpResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Perform a GET request and aggregate the full response body.
 * Connection failures and timeouts reject with `ApolloNetworkError`
 * carrying the URL. Redirects are not followed.
 *
 * @param url - absolute http(s) URL.
 * @param options - headers, timeout and optional abort signal.
 */
export function httpGet(url: string, options?: HttpRequestBodyOptions): Promise<HttpResult> {
  const headers: Record<string, string> = options?.headers ?? {};
  const timeoutMs: number = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal: AbortSignal | undefined = options?.signal;

  return new Promise<HttpResult>((resolve, reject) => {
    let mod: typeof http | typeof https;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(
          new ApolloNetworkError(
            `Apollo request has an unsupported URL protocol: ${parsed.protocol}`,
            url
          )
        );
        return;
      }
      mod = parsed.protocol === 'https:' ? https : http;
    } catch {
      reject(new ApolloNetworkError(`Apollo request has an invalid URL: ${url}`, url));
      return;
    }

    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let req: http.ClientRequest | undefined;

    /**
     * Single settle point: marks the promise as settled, clears the
     * timeout timer and detaches the abort listener exactly once.
     */
    const settleWith = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      fn();
    };

    const onAbort = (): void => {
      if (settled) return;
      const reason: unknown = signal?.reason;
      const reasonText: string =
        reason instanceof Error ? ` (reason: ${reason.message})` : '';
      settleWith(() => {
        req?.destroy();
        reject(
          new ApolloNetworkError(
            `Apollo request aborted by signal: ${url}${reasonText}`,
            url
          )
        );
      });
    };

    // An already-aborted signal must fail fast without opening a socket.
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      req = mod.request(
        url,
        {
          method: 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            settleWith(() => {
              resolve({
                statusCode: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          });
          res.on('error', (err: Error) => {
            settleWith(() => {
              reject(
                new ApolloNetworkError(`Apollo response stream failed: ${err.message} (${url})`, url)
              );
            });
          });
        }
      );

      timer = setTimeout(() => {
        settleWith(() => {
          req?.destroy();
          reject(
            new ApolloNetworkError(
              `Apollo request timed out after ${timeoutMs}ms: ${url}`,
              url
            )
          );
        });
      }, timeoutMs);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      req.on('error', (err: Error) => {
        settleWith(() => {
          reject(new ApolloNetworkError(`Apollo request failed: ${err.message} (${url})`, url));
        });
      });

      req.end();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      settleWith(() => {
        req?.destroy();
        reject(new ApolloNetworkError(`Apollo request failed: ${reason} (${url})`, url));
      });
    }
  });
}
