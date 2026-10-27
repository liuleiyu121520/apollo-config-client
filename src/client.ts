/**
 * Apollo configuration client: URL construction, single-namespace
 * `queryConfig` and the drop-in multi-namespace merge entry points
 * (`remoteConfigServiceSkipCache` / `remoteConfigServiceFromCache`).
 *
 * DERIVATION NOTICE (ISC upstream source):
 * - Upstream: node-apollo@1.2.1, ISC license,
 *   Copyright (c) 2018 Quinton.xu <Quinton.xu@gmail.com>,
 *   https://code.aliyun.com/ecarx-web/node-apollo.
 * - URL construction derives from `lib/helper.js:86-114`
 *   (getConfigSkipCacheUri / getConfigFromCacheUri) with fixes and
 *   hardening: `undefined` parameters no longer produce
 *   `?releaseKey=undefined&ip=undefined`, the base URL trailing slash
 *   is normalized, and path segments (appId / clusterName /
 *   namespaceName) are percent-encoded with `encodeURIComponent`
 *   (the base had no escaping; encoding aligns with the Java client
 *   escaper in RemoteConfigRepository.java:326-328 and is
 *   identity-preserving for common ASCII values).
 * - Merge semantics derive from `lib/helper.js:36-45`
 *   (mergeConfigurations): `payload.data.configurations || payload.data`
 *   dual shape and `Object.assign` in namespace order are preserved.
 * Full license text is preserved in THIRD-PARTY-NOTICES.md section 1.
 *
 * Signing follows the Apollo Java client 2.4.0 protocol: signature
 * headers are attached only when a non-empty secret resolves, mirroring
 * RemoteConfigRepository.java:239-242 (unsigned environments keep
 * working). 304 responses are a normal "not modified" branch, not an
 * error; when every namespace answers 304 the merge entry points
 * resolve `null` ("keep the existing configuration").
 *
 * v1.1 increments (plan §4.2):
 * - Optional `metaServerUrl`: when configured (mutually exclusive with
 *   `configServerUrl`), the base URL is resolved through the unsigned
 *   meta discovery flow in discovery.ts. `remoteConfigService` (the
 *   OpenApi inheritance surface) does NOT consume `metaServerUrl` and
 *   does NOT participate in the mutual-exclusion check (plan MIN-5).
 * - `remoteConfigServiceSikpCache` is the skipCache spelling alias and
 *   participates in the check through delegation.
 * - Grayscale IP: explicit `clientIp` wins; otherwise the local IPv4 is
 *   auto-detected (`node:os`, zero dependency). `autoDetectIp: false`
 *   restores the v1.0 behavior of carrying no `ip` parameter.
 * - `fetchNamespace` accepts `{ signal }` so the long-polling watcher
 *   can abort refetches; a network failure while a discovered address
 *   was used invalidates the discovery memo (re-discover next call).
 */

import {
  ApolloError,
  ApolloHttpError,
  ApolloNetworkError,
  ApolloUnauthorizedError,
} from './errors';
import { httpGet, HttpResult } from './http';
import { invalidateDiscoveryCache, resolveConfigServiceBaseUrl } from './discovery';
import { detectLocalIpv4 } from './local-ip';
import { resolveAccessKeySecret } from './secret';
import { buildHttpHeaders } from './signature';
import { normalizeBase } from './url';

/** Apollo server payload for one namespace (wire shape preserved). */
export interface ApolloConfig {
  appId?: string;
  cluster?: string;
  namespaceName?: string;
  releaseKey?: string;
  configurations?: Record<string, unknown>;
}

/**
 * Client options. Every field of the node-apollo base config object is
 * kept with identical semantics; the accesskey fields are additive.
 *
 * v1.1: `configServerUrl` becomes optional in the type because
 * `metaServerUrl` is an alternative address source; exactly one of the
 * two must be provided (enforced at runtime by `assertRequiredOptions`,
 * with the v1.0 error message kept for the "neither" case). The OpenApi
 * entry `remoteConfigService` is exempt (plan MIN-5).
 */
export interface ApolloClientOptions {
  /** Apollo config service base URL, e.g. `http://apollo.example.com`. */
  configServerUrl?: string;
  /**
   * Apollo meta server base URL (v1.1). Mutually exclusive with
   * `configServerUrl`: configuring both throws `ApolloError`. When set,
   * the config service base URL is discovered via the unsigned
   * `GET /services/config` flow (see discovery.ts).
   */
  metaServerUrl?: string;
  /** Apollo appId. */
  appId: string;
  /** Apollo cluster name. */
  clusterName: string;
  /** One namespace or a list; an empty list falls back to `application`. */
  namespaceName: string | string[];
  /** Optional release key (grayscale / change detection). */
  releaseKey?: string;
  /** Optional client IP for grayscale release; takes precedence over auto-detection. */
  clientIp?: string;
  /**
   * v1.1: when `false`, no `ip` query parameter is attached unless
   * `clientIp` is explicit. Defaults to `true` (auto-detect the local
   * IPv4 through `node:os`, zero dependency).
   */
  autoDetectIp?: boolean;
  /** v1.1: TTL of the meta discovery memo in milliseconds; defaults to 60000. */
  discoveryRefreshMs?: number;
  /** Layer-1 secret (explicit); see README for the full resolution chain. */
  secret?: string;
  /** Properties file path for layer-4 secret lookup. */
  propertiesPath?: string;
  /** Environment name for suffixed properties keys. */
  env?: string;
  /** Optional dataCenter query parameter (`/configs` mode only). */
  dataCenter?: string;
  /** Request timeout in milliseconds; defaults to 5000. */
  timeoutMs?: number;
}

/** Options for `queryConfig`: exactly one namespace is required. */
export interface QueryConfigOptions extends Omit<ApolloClientOptions, 'namespaceName'> {
  namespaceName: string;
}

/** Sentinel returned by `queryConfig` when the server answers 304. */
export interface QueryNotModified {
  notModified: true;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Result of one namespace fetch used by the merge layer. */
interface NamespaceResult {
  url: string;
  statusCode: number;
  body: string;
}

/**
 * Validate the fields both drop-in entry points require, with the same
 * messages as the base package (assert-style wording kept).
 *
 * v1.1: also enforces the `configServerUrl` / `metaServerUrl`
 * mutual-exclusion rule (`configServerUrl and metaServerUrl are
 * mutually exclusive, configure exactly one`). The OpenApi entry
 * `remoteConfigService` never calls this validator, so the inheritance
 * surface stays exempt (plan MIN-5).
 */
export function assertRequiredOptions(config: ApolloClientOptions): void {
  if (!config) {
    throw new ApolloError('param config is required');
  }
  const hasConfigServerUrl: boolean =
    typeof config.configServerUrl === 'string' && config.configServerUrl.length > 0;
  const hasMetaServerUrl: boolean =
    typeof config.metaServerUrl === 'string' && config.metaServerUrl.length > 0;
  if (hasConfigServerUrl && hasMetaServerUrl) {
    throw new ApolloError(
      'configServerUrl and metaServerUrl are mutually exclusive, configure exactly one'
    );
  }
  if (!hasConfigServerUrl && !hasMetaServerUrl) {
    throw new ApolloError('configServerUrl is required');
  }
  if (!config.appId) {
    throw new ApolloError('appId is required');
  }
  if (!config.clusterName) {
    throw new ApolloError('clusterName is required');
  }
  if (!config.namespaceName) {
    throw new ApolloError('namespaceName is required');
  }
}

/**
 * Normalize `namespaceName` to a list. An empty array falls back to
 * `['application']`, preserving the base package behavior
 * (node-apollo helper.js:94/109).
 */
export function normalizeNamespaces(namespaceName: string | string[]): string[] {
  const list: string[] = Array.isArray(namespaceName) ? namespaceName : [namespaceName];
  if (list.length === 0) {
    return ['application'];
  }
  return list;
}

/**
 * Join ordered query parts, skipping undefined/null/empty values so no
 * `key=undefined` fragments are ever emitted.
 */
export function joinQuery(parts: Array<[string, string | undefined]>): string {
  const rendered: string[] = [];
  for (const [name, value] of parts) {
    if (value === undefined || value === null || value.length === 0) {
      continue;
    }
    rendered.push(`${name}=${encodeURIComponent(value)}`);
  }
  return rendered.length > 0 ? `?${rendered.join('&')}` : '';
}

/**
 * Resolve the effective grayscale IP (v1.1):
 * 1. explicit `clientIp` wins;
 * 2. otherwise, unless `autoDetectIp === false`, the local IPv4 is
 *    auto-detected through `node:os` (`detectLocalIpv4`, zero dependency);
 * 3. `autoDetectIp: false` with no explicit `clientIp` yields
 *    `undefined` (no `ip` query parameter — the v1.0 default behavior).
 */
export function resolveEffectiveIp(
  config: Pick<ApolloClientOptions, 'clientIp' | 'autoDetectIp'>
): string | undefined {
  if (typeof config.clientIp === 'string' && config.clientIp.length > 0) {
    return config.clientIp;
  }
  if (config.autoDetectIp === false) {
    return undefined;
  }
  return detectLocalIpv4();
}

/**
 * Resolve the effective config service base URL (v1.1): the explicit
 * `configServerUrl` when configured, otherwise the meta discovery flow
 * (`resolveConfigServiceBaseUrl`, unsigned, TTL memo). The mutual
 * exclusion must already be validated by `assertRequiredOptions`.
 *
 * Failures of a fresh discovery fall back to the previously resolved
 * address inside the discovery module; only a discovery with no
 * previous address throws.
 */
export async function resolveBaseUrl(config: ApolloClientOptions): Promise<string> {
  const meta: string | undefined =
    typeof config.metaServerUrl === 'string' && config.metaServerUrl.length > 0
      ? config.metaServerUrl
      : undefined;
  if (meta !== undefined) {
    return resolveConfigServiceBaseUrl({
      metaServerUrl: meta,
      appId: config.appId,
      ip: resolveEffectiveIp(config),
      timeoutMs: config.timeoutMs,
      discoveryRefreshMs: config.discoveryRefreshMs,
    });
  }
  return config.configServerUrl as string;
}

/**
 * Build the `/configs/{appId}/{cluster}/{namespace}` URL for one
 * namespace. Query order is fixed: releaseKey, dataCenter, ip
 * (only defined values are appended). The `ip` value is the effective
 * grayscale IP (`resolveEffectiveIp`).
 */
export function buildSkipCacheUrl(baseUrl: string, config: ApolloClientOptions, namespace: string): string {
  const base: string = normalizeBase(baseUrl);
  const path: string =
    `${base}/configs/` +
    `${encodeURIComponent(config.appId)}/` +
    `${encodeURIComponent(config.clusterName)}/` +
    `${encodeURIComponent(namespace)}`;
  const query: string = joinQuery([
    ['releaseKey', config.releaseKey],
    ['dataCenter', config.dataCenter],
    ['ip', resolveEffectiveIp(config)],
  ]);
  return `${path}${query}`;
}

/**
 * Build the `/configfiles/json/{appId}/{cluster}/{namespace}` URL for
 * one namespace. Query carries only `ip` (only when defined), aligned
 * with the base helper.js:87-99. The `ip` value is the effective
 * grayscale IP (`resolveEffectiveIp`).
 */
export function buildFromCacheUrl(baseUrl: string, config: ApolloClientOptions, namespace: string): string {
  const base: string = normalizeBase(baseUrl);
  const path: string =
    `${base}/configfiles/json/` +
    `${encodeURIComponent(config.appId)}/` +
    `${encodeURIComponent(config.clusterName)}/` +
    `${encodeURIComponent(namespace)}`;
  const query: string = joinQuery([['ip', resolveEffectiveIp(config)]]);
  return `${path}${query}`;
}

/** Resolve the effective secret through the four-layer chain. */
function resolveSecret(config: ApolloClientOptions): string | undefined {
  return resolveAccessKeySecret({
    secret: config.secret,
    env: config.env,
    propertiesPath: config.propertiesPath,
  });
}

/** Build the base headers, adding signature headers only for a non-empty secret. */
export function buildRequestHeaders(url: string, config: ApolloClientOptions, secret: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
  };
  if (typeof secret === 'string' && secret.length > 0) {
    const signed = buildHttpHeaders(url, config.appId, secret);
    headers.Authorization = signed.Authorization;
    headers.Timestamp = signed.Timestamp;
  }
  return headers;
}

/** Map a non-2xx/non-304 response to the matching structured error. */
export function throwHttpStatusError(statusCode: number, url: string, appId: string): never {
  if (statusCode === 401) {
    throw new ApolloUnauthorizedError(appId, url);
  }
  if (statusCode === 404) {
    throw new ApolloHttpError(
      `Apollo HTTP error 404 for ${url}. The namespace may not be published ` +
        'yet, or appId/clusterName is wrong.',
      statusCode,
      url
    );
  }
  throw new ApolloHttpError(`Apollo HTTP error ${statusCode} for ${url}`, statusCode, url);
}

/** Parse a JSON response body, mapping invalid JSON to ApolloHttpError. */
export function parseJsonBody(body: string, statusCode: number, url: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new ApolloHttpError(`Apollo returned invalid JSON for ${url}`, statusCode, url);
  }
}

/**
 * Merge flat configuration records without treating special keys such as
 * `__proto__` as property setters. The returned value remains an ordinary
 * object, and records later in the list override earlier records.
 */
export function mergeFlatConfigurations(
  records: Array<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      Object.defineProperty(merged, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  return merged;
}

/** Extra options for `fetchNamespace` (v1.1). */
export interface FetchNamespaceOptions {
  /** Abort signal passed through to the HTTP layer. */
  signal?: AbortSignal;
}

/** Fetch one namespace and keep only what the merge layer needs. */
export async function fetchNamespace(
  url: string,
  config: ApolloClientOptions,
  secret: string | undefined,
  options?: FetchNamespaceOptions
): Promise<NamespaceResult> {
  const timeoutMs: number = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result: HttpResult = await httpGet(url, {
    headers: buildRequestHeaders(url, config, secret),
    timeoutMs,
    signal: options?.signal,
  });
  return { url, statusCode: result.statusCode, body: result.body };
}

/**
 * Invalidate the discovery memo when a request through a discovered
 * address failed at the network level (plan DF-18: the selected
 * address failing forces re-discovery on the next call).
 */
function invalidateDiscoveryOnNetworkFailure(config: ApolloClientOptions, err: unknown): void {
  const usesDiscovery: boolean =
    typeof config.metaServerUrl === 'string' && config.metaServerUrl.length > 0;
  if (usesDiscovery && err instanceof ApolloNetworkError) {
    invalidateDiscoveryCache();
  }
}

/**
 * Fetch exactly one namespace through the signed `/configs` endpoint.
 *
 * - 304 → resolves `{ notModified: true }` (the configuration is
 *   unchanged; the caller keeps its existing value).
 * - 200 → resolves the parsed ApolloConfig payload.
 * - 401 → throws `ApolloUnauthorizedError` (no retry).
 * - other non-2xx → `ApolloHttpError`; network/timeout →
 *   `ApolloNetworkError`.
 */
export async function queryConfig(
  config: QueryConfigOptions
): Promise<QueryNotModified | ApolloConfig> {
  assertRequiredOptions(config);
  const baseUrl: string = await resolveBaseUrl(config);
  const secret: string | undefined = resolveSecret(config);
  const url: string = buildSkipCacheUrl(baseUrl, config, config.namespaceName);
  let result: NamespaceResult;
  try {
    result = await fetchNamespace(url, config, secret);
  } catch (err) {
    invalidateDiscoveryOnNetworkFailure(config, err);
    throw err;
  }

  if (result.statusCode === 304) {
    return { notModified: true };
  }
  if (result.statusCode !== 200) {
    throwHttpStatusError(result.statusCode, url, config.appId);
  }
  const payload = parseJsonBody(result.body, result.statusCode, url) as ApolloConfig;
  return payload;
}

/**
 * Shared pipeline of the two drop-in merge entry points: build one URL
 * per namespace, fetch all namespaces concurrently, treat an all-304
 * round as "keep the existing configuration" (`null`) and merge the 200
 * payloads in namespace order (later namespaces override earlier ones).
 * A network-level failure through a discovered address invalidates the
 * discovery memo before it is rethrown.
 */
async function fetchAndMergeConfigurations(
  config: ApolloClientOptions,
  buildUrl: (baseUrl: string, config: ApolloClientOptions, namespace: string) => string
): Promise<Record<string, string> | null> {
  assertRequiredOptions(config);
  const baseUrl: string = await resolveBaseUrl(config);
  const namespaces: string[] = normalizeNamespaces(config.namespaceName);
  const secret: string | undefined = resolveSecret(config);
  const urls: string[] = namespaces.map((ns) => buildUrl(baseUrl, config, ns));
  let results: NamespaceResult[];
  try {
    results = await Promise.all(urls.map((url) => fetchNamespace(url, config, secret)));
  } catch (err) {
    invalidateDiscoveryOnNetworkFailure(config, err);
    throw err;
  }

  if (results.every((r) => r.statusCode === 304)) {
    return null;
  }

  const confs: Array<Record<string, unknown>> = [];
  for (const result of results) {
    if (result.statusCode === 304) {
      continue;
    }
    if (result.statusCode !== 200) {
      throwHttpStatusError(result.statusCode, result.url, config.appId);
    }
    const parsed = parseJsonBody(result.body, result.statusCode, result.url) as {
      configurations?: Record<string, unknown>;
    } & Record<string, unknown>;
    confs.push(parsed.configurations || parsed);
  }
  return mergeFlatConfigurations(confs) as Record<string, string>;
}

/**
 * Fetch one or many namespaces through the signed `/configs` endpoint
 * (no server-side cache) and merge the `configurations` of every
 * namespace into a single flat key/value object. Later namespaces in
 * the list override earlier ones for duplicate keys. Requests run
 * concurrently.
 *
 * When every namespace answers 304 (nothing changed for the given
 * releaseKey), the promise resolves `null`, meaning "keep the existing
 * configuration". With a mix of 200 and 304, only the 200 payloads are
 * merged.
 *
 * Drop-in compatible with node-apollo's `remoteConfigServiceSkipCache`;
 * the accesskey fields (`secret` / `propertiesPath` / `env` /
 * `dataCenter` / `timeoutMs`) are additive and optional, as are the
 * v1.1 fields (`metaServerUrl` / `autoDetectIp` / `discoveryRefreshMs`).
 */
export async function remoteConfigServiceSkipCache(
  config: ApolloClientOptions
): Promise<Record<string, string> | null> {
  return fetchAndMergeConfigurations(config, buildSkipCacheUrl);
}

/**
 * Fetch one or many namespaces through the signed `/configfiles/json`
 * endpoint (server-side cache semantics) and merge into a single flat
 * key/value object, with the same 304/null contract as
 * `remoteConfigServiceSkipCache`.
 *
 * Drop-in compatible with node-apollo's `remoteConfigServiceFromCache`.
 */
export async function remoteConfigServiceFromCache(
  config: ApolloClientOptions
): Promise<Record<string, string> | null> {
  return fetchAndMergeConfigurations(config, buildFromCacheUrl);
}
