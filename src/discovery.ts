/**
 * Meta-server service discovery for the Apollo config service.
 *
 * DERIVATION NOTICE (MIT upstream source):
 * - Upstream: @lvgithub/ctrip-apollo-client@1.0.38, MIT license,
 *   Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors,
 *   https://github.com/lvgithub/ctrip-apollo-client
 *   (src/index.js:99-114 `refreshServerUrl`: the mechanism of
 *   resolving `GET {metaServerUrl}/services/config` and picking one
 *   instance's `homepageUrl` as the config service base URL, refreshed
 *   instead of resolved once). Full license text is preserved in
 *   THIRD-PARTY-NOTICES.md section 2.
 * - Java alignment (reference/java, ConfigServiceLocator.java):
 *   the request is an UNSIGNED `GET {meta}/services/config?appId=&ip?`
 *   (:280-292 assembleMetaServiceUrl — no signature headers), an empty
 *   service list is not adopted (:246-252 `continue`), a failed update
 *   keeps the previous service list (:260 and :185-204), and the
 *   periodic refresh cadence is honored through a TTL cache.
 * - Deliberately NOT copied from upstream (copy-forbidden list):
 *   the off-by-one random pick (`Math.floor(Math.random() * (len - 1))`
 *   never selects the last instance — fixed here to include it), the
 *   unconditional per-round refresh (replaced by a TTL memo so the
 *   same meta/appId pair is not re-fetched on every poll round), and
 *   the missing timeout/abort capability (this module always carries a
 *   5s read timeout and passes an optional `AbortSignal` through).
 */

import { ApolloError, ApolloHttpError, ApolloNetworkError, toApolloError } from './errors';
import { httpGet } from './http';
import { normalizeBase } from './url';

/** Input for `resolveConfigServiceBaseUrl`. */
export interface ResolveConfigServiceInput {
  /** Apollo meta server base URL (mutually exclusive with configServerUrl upstream). */
  metaServerUrl: string;
  /** Apollo appId (part of the memo key and the `appId` query param). */
  appId: string;
  /** Optional `ip` query param (Java attaches the local IP when known). */
  ip?: string;
  /** Discovery request read timeout; defaults to 5000ms. */
  timeoutMs?: number;
  /** TTL of the resolved address; defaults to 60000ms (plan DF-18). */
  discoveryRefreshMs?: number;
  /**
   * Optional warning sink. Discovery failures that fall back to the
   * previously resolved address are reported here (the watcher wires
   * its `onWarning`); the fallback itself never throws.
   */
  onWarning?: (err: ApolloError) => void;
}

/** Options for `resolveConfigServiceBaseUrl`. */
export interface ResolveConfigServiceOptions {
  /** Skip the TTL memo and fetch a fresh service list. */
  forceRefresh?: boolean;
  /** Abort signal; an aborted discovery rejects (no stale fallback). */
  signal?: AbortSignal;
}

/** Minimal subset of the Apollo meta server `ServiceDTO` wire shape. */
interface ServiceDTO {
  homepageUrl?: string;
}

/**
 * Validate and normalize one discovered service address. Discovery only
 * accepts absolute HTTP(S) URLs; whitespace and trailing slashes are
 * removed without rebuilding the URL, so a configured path prefix stays
 * byte-for-byte intact.
 */
function normalizeServiceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed: string = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.hostname.length === 0
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return normalizeBase(trimmed);
}

/** One TTL memo entry: the selected base URL and when it was fetched. */
interface DiscoveryMemoEntry {
  baseUrl: string;
  fetchedAtMs: number;
}

const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_TTL_MS = 60000;

/**
 * The only module-level cache in this package (plan DF-18): a TTL memo
 * keyed by `normalizedMetaServerUrl::appId`. Different appId / meta
 * combinations never share entries, so multi-instance watchers stay
 * isolated; entries only ever hold a resolved base URL and a fetch
 * timestamp.
 */
const discoveryMemo = new Map<string, DiscoveryMemoEntry>();

/** Memo key: normalized meta URL + appId. */
function memoKey(metaServerUrl: string, appId: string): string {
  // Encode the tuple structurally so delimiters in either user-supplied
  // component cannot make two distinct discovery identities collide.
  return JSON.stringify([normalizeBase(metaServerUrl), appId]);
}

/**
 * Drop every memoized discovery result. Called by the watcher and by
 * the client entry points when the selected config service address
 * fails at the network level, forcing the next resolution to
 * re-discover (plan DF-18).
 */
export function invalidateDiscoveryCache(): void {
  discoveryMemo.clear();
}

/**
 * Resolve the config service base URL, optionally through the meta
 * server discovery flow. Callers that do not configure a
 * `metaServerUrl` never reach this module.
 *
 * Behavior (plan DF-18):
 * - Unsigned `GET {meta}/services/config?appId=&ip?` with a 5s read
 *   timeout; `signal` is passed through to the HTTP layer.
 * - The resolved homepageUrl is memoized per (metaServerUrl, appId)
 *   with a TTL (`discoveryRefreshMs`, default 60s); `forceRefresh`
 *   bypasses the memo.
 * - A fresh fetch that succeeds replaces the memo entry; a fresh fetch
 *   that fails (network error / non-200 / invalid payload / empty
 *   list) keeps the previously resolved address and reports through
 *   `onWarning` — only when no previous address exists does it throw.
 * - An aborted `signal` always rejects (no stale fallback), so `stop()`
 *   cannot leave a pending discovery behind.
 *
 * @returns the config service base URL (trailing slash stripped).
 */
export async function resolveConfigServiceBaseUrl(
  config: ResolveConfigServiceInput,
  options?: ResolveConfigServiceOptions
): Promise<string> {
  const meta: string = normalizeBase(config.metaServerUrl || '');
  if (meta.length === 0) {
    throw new ApolloError('metaServerUrl is required for service discovery');
  }
  if (!config.appId) {
    throw new ApolloError('appId is required');
  }

  const ttlMs: number =
    typeof config.discoveryRefreshMs === 'number' && Number.isFinite(config.discoveryRefreshMs) &&
    config.discoveryRefreshMs > 0
      ? config.discoveryRefreshMs
      : DISCOVERY_TTL_MS;
  const key: string = memoKey(meta, config.appId);
  const cached: DiscoveryMemoEntry | undefined = discoveryMemo.get(key);
  const now: number = Date.now();

  // The abort contract applies even when the TTL memo would otherwise
  // satisfy the request. Match httpGet's error type and avoid silently
  // accepting a stale result for an already-cancelled operation.
  const queryParts: string[] = [`appId=${encodeURIComponent(config.appId)}`];
  if (typeof config.ip === 'string' && config.ip.length > 0) {
    queryParts.push(`ip=${encodeURIComponent(config.ip)}`);
  }
  const url: string = `${meta}/services/config?${queryParts.join('&')}`;
  if (options?.signal?.aborted === true) {
    throw new ApolloNetworkError(`Apollo request aborted by signal: ${url}`, url);
  }

  if (
    options?.forceRefresh !== true &&
    cached !== undefined &&
    now - cached.fetchedAtMs < ttlMs
  ) {
    return cached.baseUrl;
  }

  // Java ConfigServiceLocator.java:280-292 — unsigned, appId first,
  // optional ip. Query order is fixed for determinism.
  let freshBaseUrl: string | undefined;
  let failure: ApolloError | undefined;
  try {
    const result = await httpGet(url, {
      timeoutMs: config.timeoutMs ?? DISCOVERY_TIMEOUT_MS,
      signal: options?.signal,
    });
    if (result.statusCode !== 200) {
      throw new ApolloHttpError(
        `Apollo discovery request failed with HTTP ${result.statusCode} for ${url}`,
        result.statusCode,
        url
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(result.body);
    } catch {
      throw new ApolloHttpError(
        `Apollo returned invalid JSON for ${url}`,
        result.statusCode,
        url
      );
    }
    if (!Array.isArray(payload)) {
      throw new ApolloHttpError(
        `Apollo discovery response is not an array for ${url}`,
        result.statusCode,
        url
      );
    }
    const candidates: string[] = (payload as ServiceDTO[])
      .map((dto) => normalizeServiceUrl(dto?.homepageUrl))
      .filter((candidate): candidate is string => candidate !== undefined);
    if (candidates.length === 0) {
      // Empty list: Java keeps the previous services (:246-252).
      failure = new ApolloError(
        `Apollo discovery returned an empty service list for ${url}`,
        url
      );
    } else {
      // Load-balanced pick. Upstream's `Math.floor(Math.random() * (len - 1))`
      // never selected the last instance; the full range is used here.
      freshBaseUrl = candidates[Math.floor(Math.random() * candidates.length)];
    }
  } catch (err) {
    failure = toApolloError(err, 'Apollo service discovery failed', url);
  }

  if (freshBaseUrl !== undefined) {
    discoveryMemo.set(key, { baseUrl: freshBaseUrl, fetchedAtMs: Date.now() });
    return freshBaseUrl;
  }

  // An actively aborted discovery must reject instead of falling back,
  // so a stopped watcher never resurrects a request path.
  if (options?.signal?.aborted && failure !== undefined) {
    throw failure;
  }

  if (cached !== undefined) {
    // Failed refresh: keep the previous address, report, do not throw.
    if (failure !== undefined) {
      config.onWarning?.(failure);
    }
    return cached.baseUrl;
  }

  throw (
    failure ??
    new ApolloError(`Apollo service discovery failed for ${url}`, url)
  );
}
