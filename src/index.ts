/**
 * apollo-config-client public API.
 *
 * Drop-in baseline (node-apollo compatible, change the package name
 * and it works): remoteConfigServiceSkipCache / remoteConfigServiceFromCache
 * / remoteConfigService / remoteConfigServiceSikpCache (deprecated
 * spelling alias) / createEnvFile / setEnv.
 *
 * Accesskey extensions: queryConfig, signature, buildHttpHeaders,
 * url2PathWithQuery, resolveAccessKeySecret and the structured error
 * classes.
 *
 * v1.1 mechanism extensions (plan §4.2): the long-polling watcher
 * (`ApolloWatcher` / `createApolloWatcher`), local IPv4 detection
 * (`detectLocalIpv4`), meta discovery cache control
 * (`invalidateDiscoveryCache`) and the local cache path helper
 * (`defaultCachePath`), plus their related types. See README.md /
 * README.zh-CN.md for usage.
 */

// Structured error classes.
export { ApolloError, ApolloUnauthorizedError, ApolloHttpError, ApolloNetworkError } from './errors';

// Signature toolkit (Apollo Java client 2.4.0 protocol).
export { signature, buildHttpHeaders, url2PathWithQuery } from './signature';

// Secret resolution.
export { resolveAccessKeySecret } from './secret';

// Client: drop-in multi-namespace entry points + single-namespace query.
export {
  queryConfig,
  remoteConfigServiceSkipCache,
  remoteConfigServiceFromCache,
} from './client';

// Base-package inheritance surface (OpenApi passthrough, env helpers).
export {
  remoteConfigService,
  remoteConfigServiceSikpCache,
  createEnvFile,
  setEnv,
} from './compat';

// v1.1: long-polling watcher (plan FR-8 / FR-12, AC-15/16/20).
export { ApolloWatcher, createApolloWatcher } from './watch';

// v1.1: local IPv4 auto-detection (plan FR-10, AC-18).
export { detectLocalIpv4 } from './local-ip';

// v1.1: meta discovery cache control (plan FR-11, AC-19).
export { invalidateDiscoveryCache } from './discovery';

// v1.1: local cache path helper (plan FR-9, AC-17).
export { defaultCachePath } from './cache';

// Public types.
export type {
  ApolloClientOptions,
  QueryConfigOptions,
  QueryNotModified,
} from './client';
export type { ApolloConfig } from './client';
export type { ApolloOpenApiOptions } from './compat';
export type { ResolveAccessKeySecretInput } from './secret';
export type { HttpResult } from './http';

// v1.1 types.
export type {
  ApolloWatcherOptions,
  WatcherChangeEvent,
  WatcherCacheLoadedEvent,
} from './watch';
export type {
  ResolveConfigServiceInput,
  ResolveConfigServiceOptions,
} from './discovery';
export type {
  CacheFileContent,
  CacheNamespaceEntry,
  DefaultCachePathInput,
} from './cache';
