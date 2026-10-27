/**
 * Apollo long-polling watcher: `/notifications/v2` push-style config
 * updates with local cache recovery, meta discovery and change
 * callbacks.
 *
 * DERIVATION NOTICE (MIT upstream source):
 * - Upstream: @lvgithub/ctrip-apollo-client@1.0.38, MIT license,
 *   Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors,
 *   https://github.com/lvgithub/ctrip-apollo-client
 *   (src/index.js:76-247 the long-polling loop mechanism:
 *   `/notifications/v2` with per-namespace notificationId, 304
 *   continues, 200 refetches the changed namespaces through `/configs`
 *   and fires the change callback; src/index.js:117-119 the `stop`
 *   mechanism; src/index.js:301-318 the init / cache-recovery
 *   mechanism). Full license text is preserved in
 *   THIRD-PARTY-NOTICES.md section 2.
 * - Java alignment (reference/java, RemoteConfigLongPollService.java):
 *   read timeout default 90s (`:74-75` LONG_POLLING_READ_TIMEOUT =
 *   90 * 1000, deliberately longer than the ~60s server hold), initial
 *   notificationId -1 (ConfigConsts.NOTIFICATION_ID_PLACEHOLDER), a
 *   200 response updates the notification map only for tracked
 *   namespaces (`:262-278` updateNotifications contains-guard) and the
 *   failure schedule is exponential 1s→120s with reset on success
 *   (`:96` ExponentialSchedulePolicy(1, 120), `:209/:216`).
 * - Deliberately NOT copied from upstream (copy-forbidden list):
 *   ① no-timeout requests (every request carries a timeout: long poll
 *   90s default, refetch/discovery 5s; `initTimeoutMs` bounds
 *   `start()`); ② a polling loop that keeps running after a failed
 *   init (here `start()` rejects in a bounded way while the loop keeps
 *   retrying WITHOUT reporting errors after `stop()`); ③ the
 *   `global._apollo` global singleton (instances are fully private,
 *   multi-instance safe); ④ the dotted-key expansion of configuration
 *   keys (configurations stay flat); ⑤ the unconditional per-round
 *   service re-discovery (a TTL memo is used instead, see
 *   discovery.ts); ⑥ the missing abort capability (one
 *   `AbortController` per watcher run; `stop()` aborts every in-flight
 *   long poll / refetch / discovery, clears the backoff timer and
 *   rebuilds a fresh controller + `-1` notificationIds so the watcher
 *   can be restarted cleanly).
 */

import { ApolloClientOptions, assertRequiredOptions, buildRequestHeaders, buildSkipCacheUrl, fetchNamespace, mergeFlatConfigurations, normalizeNamespaces, parseJsonBody, resolveEffectiveIp, throwHttpStatusError } from './client';
import {
  defaultCachePath,
  loadConfigCache,
  writeConfigCacheAtomic,
  CacheNamespaceEntry,
} from './cache';
import { invalidateDiscoveryCache, resolveConfigServiceBaseUrl } from './discovery';
import { ApolloError, ApolloHttpError, ApolloNetworkError, toApolloError } from './errors';
import { httpGet } from './http';
import { resolveAccessKeySecret } from './secret';
import { normalizeBase } from './url';

/** Long-poll read timeout default: 90s (Java RemoteConfigLongPollService.java:74-75). */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 90000;

/** `start()` bootstrap deadline default (plan DF-16). */
const DEFAULT_INIT_TIMEOUT_MS = 10000;

/** Backoff schedule: exponential ×2 from 1s, capped at 120s (Java :96/:209/:216). */
const DEFAULT_RETRY_INITIAL_MS = 1000;
const DEFAULT_RETRY_MAX_MS = 120000;

/** Event delivered through `onChange` (plan DF-19). */
export interface WatcherChangeEvent {
  /** The full merged flat configuration after the change. */
  config: Record<string, string>;
  /** Namespaces that were refetched during this poll round. */
  changedNamespaces: string[];
  /** Where the change came from; currently only server pushes. */
  source: 'server';
}

/** Event delivered through `onCacheLoaded`. */
export interface WatcherCacheLoadedEvent {
  /** The full merged flat configuration recovered from the local cache. */
  config: Record<string, string>;
}

/**
 * One `/notifications/v2` notification item (wire shape:
 * `{ namespaceName, notificationId }`, namespaceName first).
 */
interface NotificationItem {
  namespaceName?: unknown;
  notificationId?: unknown;
}

/**
 * Watcher options. Address fields mirror `ApolloClientOptions` with
 * `configServerUrl` optional (meta discovery is the alternative); the
 * mutual-exclusion rule is enforced in the constructor. `releaseKey`
 * is intentionally NOT a watcher option: refetches never carry one
 * (plan §5.3).
 */
export interface ApolloWatcherOptions
  extends Omit<ApolloClientOptions, 'configServerUrl' | 'namespaceName' | 'releaseKey'> {
  /** Apollo config service base URL; exactly one of this and `metaServerUrl`. */
  configServerUrl?: string;
  /** One namespace or a list; an empty list falls back to `application`. */
  namespaceName: string | string[];
  /** Long-poll read timeout in ms; defaults to 90000 (must stay above the ~60s server hold). */
  longPollTimeoutMs?: number;
  /** `start()` bootstrap deadline in ms; defaults to 10000. */
  initTimeoutMs?: number;
  /** First backoff delay in ms; defaults to 1000. */
  retryInitialMs?: number;
  /** Backoff cap in ms; defaults to 120000. */
  retryMaxMs?: number;
  /**
   * Cache behavior: `undefined` → default file under
   * `.apollo-config-client-cache/` (isolation-keyed file name); a
   * string → that exact file path; `false` → caching disabled.
   */
  cachePath?: string | false;
  /** Change callback: full merged config + changed namespaces per poll round. */
  onChange?: (event: WatcherChangeEvent) => void;
  /** Warning callback: every recoverable failure except stop-induced aborts. */
  onWarning?: (err: ApolloError) => void;
  /** Fired when configuration was recovered from the local cache at `start()`. */
  onCacheLoaded?: (event: WatcherCacheLoadedEvent) => void;
}

/** Options with every default applied (internal). */
interface ResolvedWatcherOptions extends ApolloWatcherOptions {
  longPollTimeoutMs: number;
  initTimeoutMs: number;
  retryInitialMs: number;
  retryMaxMs: number;
}

/** Guard: fall back to the default when the provided number is not a positive finite integer. */
function positiveIntOr(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

/** Create a dictionary whose namespace keys cannot resolve through Object.prototype. */
function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Own-key check for untrusted namespace names such as `constructor`. */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Copy only own enumerable data properties without invoking the `__proto__`
 * setter on an ordinary object. The target keeps Object.prototype as its
 * prototype while `__proto__` remains a normal own configuration key.
 */
function copyOwnData(target: Record<string, unknown>, source: unknown): void {
  if (source === null || typeof source !== 'object') {
    return;
  }
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      continue;
    }
    Object.defineProperty(target, key, {
      value: descriptor.value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

/** Clone a configuration object while preserving a plain Object prototype. */
function cloneConfigurations(source: unknown): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  copyOwnData(target, source);
  return target;
}

/**
 * Long-polling Apollo watcher (plan §5).
 *
 * Lifecycle:
 * - `start()` is idempotent: it resolves immediately when a
 *   configuration is already available (cache recovery or a previous
 *   run's in-memory state); otherwise it resolves when the bootstrap
 *   round completes (first successful long-poll round: a 304, or a 200
 *   whose refetches finished). When the bootstrap does not complete
 *   within `initTimeoutMs`, the returned promise rejects with an
 *   `ApolloError` — the watcher keeps running and retrying.
 * - `stop()` reclaims everything (plan §5.2 five steps): sets the
 *   suppress flag, aborts the current `AbortController` (in-flight
 *   long poll / refetch / discovery fail immediately), clears the
 *   backoff timer, then resets notificationIds to `-1`, builds a fresh
 *   `AbortController` and clears the flag so `start()` can be called
 *   again. Errors caused by the stop itself are never reported.
 * - Every instance owns all of its mutable state; the only module-level
 *   cache in the package is the read-only discovery TTL memo.
 */
export class ApolloWatcher {
  private readonly options: ResolvedWatcherOptions;
  /** Client-shaped view used by the shared URL/header builders. */
  private readonly clientConfig: ApolloClientOptions;
  /** Deduplicated namespace list in option order. */
  private readonly namespaces: string[];
  /** Cache file path; `undefined` when caching is disabled. */
  private readonly cacheFilePath: string | undefined;

  /** notificationId per namespace; `-1` until the server reports one. */
  private notificationIds: Record<string, number> = createDictionary<number>();
  /** Last known payload per namespace (flat configurations + releaseKey). */
  private namespaceData: Record<string, CacheNamespaceEntry> =
    createDictionary<CacheNamespaceEntry>();
  /** Full merged flat configuration; `undefined` until first data. */
  private mergedConfig: Record<string, string> | undefined;

  /** AbortController of the current run; rebuilt by every `stop()`. */
  private controller: AbortController = new AbortController();
  /** Suppress flag: while true, failures are neither reported nor backed off. */
  private stopped = false;
  /** Loop generation; bumped by `stop()`/`start()` to sever stale loops. */
  private generation = 0;
  /** Whether the loop of the current generation is alive. */
  private running = false;
  /** The promise returned by the most recent `start()`. */
  private startPromise: Promise<void> | undefined;

  /** Bootstrap deferred state (first successful round). */
  private bootstrapSettled = true;
  private bootstrapResolve: (() => void) | undefined;
  private bootstrapReject: ((err: ApolloError) => void) | undefined;
  private initTimer: NodeJS.Timeout | undefined;

  /** Cancellable backoff sleep state (cleared by `stop()`). */
  private sleepTimer: NodeJS.Timeout | undefined;
  private sleepWake: (() => void) | undefined;

  /** Current backoff delay; reset to `retryInitialMs` on every success. */
  private currentBackoffMs: number;
  /** Cache already attempted once (restarts keep the in-memory state). */
  private cacheLoadedOnce = false;

  constructor(options: ApolloWatcherOptions) {
    if (!options || typeof options !== 'object') {
      throw new ApolloError('param options is required');
    }
    const normalized: ApolloWatcherOptions = { ...options };
    // Mutual exclusion + required fields (v1.0 message wording preserved).
    assertRequiredOptions(normalized as ApolloClientOptions);

    this.options = {
      ...normalized,
      longPollTimeoutMs: positiveIntOr(
        normalized.longPollTimeoutMs,
        DEFAULT_LONG_POLL_TIMEOUT_MS
      ),
      initTimeoutMs: positiveIntOr(normalized.initTimeoutMs, DEFAULT_INIT_TIMEOUT_MS),
      retryInitialMs: positiveIntOr(normalized.retryInitialMs, DEFAULT_RETRY_INITIAL_MS),
      retryMaxMs: positiveIntOr(normalized.retryMaxMs, DEFAULT_RETRY_MAX_MS),
    };
    this.namespaces = Array.from(new Set(normalizeNamespaces(normalized.namespaceName)));
    this.clientConfig = {
      ...(normalized as ApolloClientOptions),
      namespaceName: this.namespaces,
    };
    this.currentBackoffMs = this.options.retryInitialMs;
    this.notificationIds = createDictionary<number>();
    for (const ns of this.namespaces) {
      this.notificationIds[ns] = -1;
    }

    // Cache path resolution (plan DF-17). The isolation key mixes the
    // unique configured address (after the mutual-exclusion check) and
    // the sorted namespace list; dynamic discovery addresses are not
    // part of the key.
    if (this.options.cachePath === false) {
      this.cacheFilePath = undefined;
    } else if (typeof this.options.cachePath === 'string' && this.options.cachePath.length > 0) {
      this.cacheFilePath = this.options.cachePath;
    } else {
      const uniqueBaseUrl: string =
        (this.options.configServerUrl ?? this.options.metaServerUrl ?? '').replace(/\/+$/, '');
      this.cacheFilePath = defaultCachePath({
        appId: this.options.appId,
        clusterName: this.options.clusterName,
        namespaces: this.namespaces,
        uniqueBaseUrl,
      });
    }
  }

  /** Whether a loop of the current generation is active and not stopping. */
  private alive(gen: number): boolean {
    return !this.stopped && gen === this.generation;
  }

  /**
   * Start the watcher (idempotent).
   *
   * - With configuration already available (cache recovery or previous
   *   run), resolves immediately and fires `onCacheLoaded` for a cache
   *   recovery.
   * - Otherwise resolves when the bootstrap round completes, or rejects
   *   with an `ApolloError` after `initTimeoutMs`. A rejection does NOT
   *   stop the watcher: the loop keeps retrying in the background.
   */
  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    const cacheRecoveryGeneration: number = this.generation;

    // Cache recovery (once per instance; restarts keep in-memory state).
    if (!this.cacheLoadedOnce) {
      this.cacheLoadedOnce = true;
      if (this.cacheFilePath !== undefined) {
        const cached = loadConfigCache(this.cacheFilePath);
        if (
          cached !== undefined &&
          cached.appId === this.options.appId &&
          cached.clusterName === this.options.clusterName
        ) {
          for (const ns of this.namespaces) {
            if (!hasOwn(cached.namespaces, ns)) {
              continue;
            }
            const entry: CacheNamespaceEntry = cached.namespaces[ns];
            if (entry !== undefined && entry !== null && typeof entry === 'object') {
              this.namespaceData[ns] = {
                releaseKey: typeof entry.releaseKey === 'string' ? entry.releaseKey : undefined,
                configurations: cloneConfigurations(entry.configurations),
              };
            }
          }
          if (Object.keys(this.namespaceData).length > 0) {
            this.recomputeMergedConfig();
            this.fireOnCacheLoaded();
          }
        }
      }
    }

    // A cache callback may synchronously call stop() or start(). Respect
    // that lifecycle transition instead of launching the outer run.
    if (this.generation !== cacheRecoveryGeneration) {
      return this.startPromise ?? Promise.resolve();
    }

    if (this.mergedConfig !== undefined) {
      this.startPromise = Promise.resolve();
    } else {
      // Bounded bootstrap: settle on the first successful round or on
      // the init deadline, whichever comes first.
      this.bootstrapSettled = false;
      this.startPromise = new Promise<void>((resolve, reject) => {
        this.bootstrapResolve = resolve;
        this.bootstrapReject = reject;
      });
      this.initTimer = setTimeout(() => {
        this.settleBootstrapFailure(
          new ApolloError(
            `Apollo watcher bootstrap did not complete within ${this.options.initTimeoutMs}ms ` +
              `(appId=${this.options.appId}); the watcher keeps retrying in the background`
          )
        );
      }, this.options.initTimeoutMs);
    }

    const gen: number = ++this.generation;
    this.stopped = false;
    this.running = true;
    void this.run(gen);
    return this.startPromise;
  }

  /**
   * Stop the watcher and reclaim every resource (plan §5.2, five steps
   * in order). Safe to call multiple times and before `start()`.
   * After `stop()` the watcher can be started again.
   */
  stop(): void {
    if (!this.running && !this.startPromise) {
      // Never started (or already fully torn down): keep the reset
      // invariants anyway so a later `start()` is clean.
      this.resetForRestart();
      return;
    }
    // Step 1+2: suppress — every failure from now on is neither
    // reported through onWarning nor answered with a backoff sleep.
    this.stopped = true;
    // Step 3: abort — in-flight long poll / refetch / discovery fail
    // immediately with an aborted-signal network error (suppressed).
    this.controller.abort();
    // Bootstrap contract: a pending start() must settle, never hang.
    this.settleBootstrapFailure(
      new ApolloError('Apollo watcher stopped before bootstrap completed')
    );
    // Step 4: clear the backoff timer and wake the sleeping loop so it
    // exits at once instead of after the current backoff delay.
    if (this.sleepTimer !== undefined) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = undefined;
    }
    if (this.sleepWake !== undefined) {
      const wake: (() => void) | undefined = this.sleepWake;
      this.sleepWake = undefined;
      wake();
    }
    // Step 5: reset for a clean restart — notificationIds back to -1,
    // a brand-new AbortController, suppress flag cleared.
    this.resetForRestart();
  }

  /** Step 5 of `stop()`: reset ids, controller, generation and flags. */
  private resetForRestart(): void {
    this.notificationIds = createDictionary<number>();
    for (const ns of this.namespaces) {
      this.notificationIds[ns] = -1;
    }
    this.controller = new AbortController();
    // Bump the generation so a loop still unwinding exits at its next
    // checkpoint without touching state.
    this.generation++;
    this.running = false;
    this.startPromise = undefined;
    this.currentBackoffMs = this.options.retryInitialMs;
    this.stopped = false;
  }

  /** Whether the watcher's polling loop is currently alive. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * The full merged flat configuration, or `undefined` before any
   * configuration was loaded (server or cache).
   */
  getConfig(): Record<string, string> | undefined {
    return this.mergedConfig;
  }

  /**
   * Resolve the base URL for this round: meta discovery (TTL memo,
   * warning-wired, signal-aware) or the explicit configServerUrl.
   */
  private async resolveWatchBaseUrl(gen: number, signal: AbortSignal): Promise<string> {
    const meta: string | undefined =
      typeof this.options.metaServerUrl === 'string' && this.options.metaServerUrl.length > 0
        ? this.options.metaServerUrl
        : undefined;
    if (meta !== undefined) {
      return resolveConfigServiceBaseUrl(
        {
          metaServerUrl: meta,
          appId: this.options.appId,
          ip: resolveEffectiveIp(this.clientConfig),
          timeoutMs: this.options.timeoutMs,
          discoveryRefreshMs: this.options.discoveryRefreshMs,
          onWarning: (err: ApolloError) => {
            // Suppress stop-induced warnings (plan §5.2).
            if (this.alive(gen)) {
              this.fireOnWarning(err);
            }
          },
        },
        { signal }
      );
    }
    return this.clientConfig.configServerUrl as string;
  }

  /** Build the signed `/notifications/v2` URL for the current ids. */
  private buildNotificationsUrl(baseUrl: string): string {
    const base: string = normalizeBase(baseUrl);
    // JSON field order: namespaceName first (plan §5.3).
    const notificationsJson: string = JSON.stringify(
      this.namespaces.map((ns) => ({
        namespaceName: ns,
        notificationId: this.notificationIds[ns] ?? -1,
      }))
    );
    // Deterministic query order: appId → cluster → notifications →
    // dataCenter → ip (Java HashMap order is not a contract; the
    // signature covers the raw URL either way).
    const parts: string[] = [
      `appId=${encodeURIComponent(this.options.appId)}`,
      `cluster=${encodeURIComponent(this.options.clusterName)}`,
      `notifications=${encodeURIComponent(notificationsJson)}`,
    ];
    if (typeof this.options.dataCenter === 'string' && this.options.dataCenter.length > 0) {
      parts.push(`dataCenter=${encodeURIComponent(this.options.dataCenter)}`);
    }
    const ip: string | undefined = resolveEffectiveIp(this.clientConfig);
    if (ip !== undefined) {
      parts.push(`ip=${encodeURIComponent(ip)}`);
    }
    return `${base}/notifications/v2?${parts.join('&')}`;
  }

  /** The main polling loop for one generation. */
  private async run(gen: number): Promise<void> {
    try {
      while (this.alive(gen)) {
        let baseUrl: string;
        try {
          baseUrl = await this.resolveWatchBaseUrl(gen, this.controller.signal);
        } catch (err) {
          this.handleLoopFailure(gen, err);
          if (!this.alive(gen)) {
            break;
          }
          await this.sleepBackoff();
          continue;
        }
        if (!this.alive(gen)) {
          break;
        }
        try {
          await this.pollOnce(gen, baseUrl);
        } catch (err) {
          this.handleLoopFailure(gen, err);
          if (!this.alive(gen)) {
            break;
          }
          await this.sleepBackoff();
          continue;
        }
        // `pollOnce` can return after a synchronous callback calls stop()
        // or starts a newer generation. Do not let this stale loop reset the
        // new generation's backoff or settle its bootstrap promise.
        if (!this.alive(gen)) {
          break;
        }
        // A full round finished without error: reset the backoff
        // schedule and settle a pending bootstrap.
        this.currentBackoffMs = this.options.retryInitialMs;
        this.settleBootstrapSuccess();
      }
    } finally {
      // Only the loop of the current generation may clear `running`;
      // a superseded loop leaves the flag to its successor / stop().
      if (gen === this.generation) {
        this.running = false;
      }
    }
  }

  /**
   * One long-poll round. 304 → return (zero state mutation); 200 →
   * contains-guarded refetch + id update + onChange; anything else →
   * throw (failure path: warning + backoff).
   */
  private async pollOnce(gen: number, baseUrl: string): Promise<void> {
    const url: string = this.buildNotificationsUrl(baseUrl);
    const secret: string | undefined = resolveAccessKeySecret(this.clientConfig);
    const headers: Record<string, string> = buildRequestHeaders(url, this.clientConfig, secret);
    const result = await httpGet(url, {
      headers,
      timeoutMs: this.options.longPollTimeoutMs,
      signal: this.controller.signal,
    });
    if (!this.alive(gen)) {
      return;
    }
    // 304: nothing changed — keep polling, zero state mutation.
    if (result.statusCode === 304) {
      return;
    }
    if (result.statusCode !== 200) {
      throwHttpStatusError(result.statusCode, url, this.options.appId);
    }
    const body = parseJsonBody(result.body, result.statusCode, url);
    if (!Array.isArray(body)) {
      // The server answered but the payload shape is wrong: an HTTP-level
      // error, NOT a network failure (so the discovery memo must survive).
      throw new ApolloHttpError(
        `Apollo notifications response is not an array for ${url}`,
        result.statusCode,
        url
      );
    }
    // Contains guard: only namespaces this watcher tracks are acted on.
    const changed: NotificationItem[] = (body as NotificationItem[]).filter(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof item.namespaceName === 'string' &&
        hasOwn(this.notificationIds, item.namespaceName)
    );
    const changedNamespaces: string[] = [];
    // Stage every update in private dictionaries. A failed refetch must
    // leave the previous namespace data, merged config, cache, and ids
    // untouched; commit only after the whole notification round succeeds.
    const nextNamespaceData: Record<string, CacheNamespaceEntry> = this.cloneNamespaceData();
    const nextNotificationIds: Record<string, number> = this.cloneNotificationIds();
    let fetchedNewData = false;
    for (const item of changed) {
      const ns: string = item.namespaceName as string;
      // Refetch FIRST; the notificationId is advanced only afterwards
      // (at-least-once: a failed refetch leaves the id untouched and
      // the server will notify again).
      const entry: CacheNamespaceEntry | undefined = await this.refetchNamespace(gen, baseUrl, ns);
      if (!this.alive(gen)) {
        return;
      }
      if (entry !== undefined) {
        nextNamespaceData[ns] = entry;
        fetchedNewData = true;
      }
      if (typeof item.notificationId === 'number') {
        nextNotificationIds[ns] = item.notificationId;
      }
      changedNamespaces.push(ns);
    }
    if (changedNamespaces.length > 0 && this.alive(gen)) {
      this.namespaceData = nextNamespaceData;
      this.notificationIds = nextNotificationIds;
      // An all-304 round fetched no new payload: notification ids must still
      // advance (the server would re-notify forever), while the merged config,
      // the cache and onChange keep the previous state (zero mutation on 304).
      if (fetchedNewData) {
        this.mergedConfig = this.buildMergedConfig(this.namespaceData);
        this.writeCacheBestEffort();
        if (this.alive(gen)) {
          this.fireOnChange(gen, changedNamespaces);
        }
      }
    }
  }

  /**
   * Refetch one namespace through the signed `/configs` endpoint
   * WITHOUT a releaseKey (plan §5.3) and return the staged payload. A
   * 304 keeps the existing configuration; the caller commits only after
   * all namespaces in the notification round have succeeded.
   */
  private async refetchNamespace(
    gen: number,
    baseUrl: string,
    ns: string
  ): Promise<CacheNamespaceEntry | undefined> {
    // Refetches never carry a releaseKey (plan §5.3).
    const refetchConfig: ApolloClientOptions = { ...this.clientConfig, releaseKey: undefined };
    const url: string = buildSkipCacheUrl(baseUrl, refetchConfig, ns);
    const secret: string | undefined = resolveAccessKeySecret(this.clientConfig);
    const result = await fetchNamespace(url, this.clientConfig, secret, {
      signal: this.controller.signal,
    });
    if (!this.alive(gen)) {
      return;
    }
    if (result.statusCode === 304) {
      return; // configuration unchanged; keep the existing payload
    }
    if (result.statusCode !== 200) {
      throwHttpStatusError(result.statusCode, url, this.options.appId);
    }
    const parsed = parseJsonBody(result.body, result.statusCode, url);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApolloHttpError(
        `Apollo config response payload must be a non-array object for ${url}`,
        result.statusCode,
        url
      );
    }
    const payload = parsed as { releaseKey?: unknown; configurations?: unknown };
    if (
      payload.configurations === null ||
      typeof payload.configurations !== 'object' ||
      Array.isArray(payload.configurations)
    ) {
      throw new ApolloHttpError(
        `Apollo config response configurations must be a non-array object for ${url}`,
        result.statusCode,
        url
      );
    }
    return {
      releaseKey: typeof payload.releaseKey === 'string' ? payload.releaseKey : undefined,
      configurations: cloneConfigurations(payload.configurations),
    };
  }

  /** Recompute the merged flat configuration in namespace-list order (flat, no dot expansion). */
  private recomputeMergedConfig(): void {
    this.mergedConfig = this.buildMergedConfig(this.namespaceData);
  }

  /** Merge namespace data in configured order while preserving safe own keys. */
  private buildMergedConfig(
    namespaceData: Record<string, CacheNamespaceEntry>
  ): Record<string, string> {
    const records: Array<Record<string, unknown>> = [];
    for (const ns of this.namespaces) {
      if (!hasOwn(namespaceData, ns)) {
        continue;
      }
      records.push(namespaceData[ns].configurations);
    }
    return mergeFlatConfigurations(records) as Record<string, string>;
  }

  /** Clone namespace state into a null-prototype dictionary for staging. */
  private cloneNamespaceData(): Record<string, CacheNamespaceEntry> {
    const cloned: Record<string, CacheNamespaceEntry> = createDictionary<CacheNamespaceEntry>();
    for (const ns of this.namespaces) {
      if (!hasOwn(this.namespaceData, ns)) {
        continue;
      }
      const entry: CacheNamespaceEntry = this.namespaceData[ns];
      cloned[ns] = {
        releaseKey: entry.releaseKey,
        configurations: cloneConfigurations(entry.configurations),
      };
    }
    return cloned;
  }

  /** Clone notification ids into a null-prototype dictionary for staging. */
  private cloneNotificationIds(): Record<string, number> {
    const cloned: Record<string, number> = createDictionary<number>();
    for (const ns of this.namespaces) {
      cloned[ns] = hasOwn(this.notificationIds, ns) ? this.notificationIds[ns] : -1;
    }
    return cloned;
  }

  /** Persist the current state; write failures surface through onWarning only. */
  private writeCacheBestEffort(): void {
    if (this.cacheFilePath === undefined) {
      return;
    }
    try {
      const namespaces: Record<string, CacheNamespaceEntry> =
        createDictionary<CacheNamespaceEntry>();
      for (const ns of this.namespaces) {
        if (hasOwn(this.namespaceData, ns)) {
          const entry: CacheNamespaceEntry = this.namespaceData[ns];
          namespaces[ns] = {
            releaseKey: entry.releaseKey,
            configurations: cloneConfigurations(entry.configurations),
          };
        }
      }
      writeConfigCacheAtomic(this.cacheFilePath, {
        version: 1,
        appId: this.options.appId,
        clusterName: this.options.clusterName,
        namespaces,
      });
    } catch (err) {
      this.fireOnWarning(toApolloError(err, 'Apollo watcher error'));
    }
  }

  /**
   * Shared failure path: suppress stop-induced errors, invalidate the
   * discovery memo on network failures through a discovered address,
   * and report through onWarning.
   */
  private handleLoopFailure(gen: number, err: unknown): void {
    if (!this.alive(gen)) {
      return; // 抑制态: stop-induced failures are never reported.
    }
    const usesDiscovery: boolean =
      typeof this.options.metaServerUrl === 'string' && this.options.metaServerUrl.length > 0;
    if (usesDiscovery && err instanceof ApolloNetworkError) {
      // The selected address failed at the network level: force
      // re-discovery on the next round (plan DF-18).
      invalidateDiscoveryCache();
    }
    this.fireOnWarning(toApolloError(err, 'Apollo watcher error'));
  }

  /**
   * Backoff sleep with exponential growth (×2, capped at retryMaxMs).
   * The delay is cancelled by `stop()` (step 4), which wakes the loop
   * immediately.
   */
  private async sleepBackoff(): Promise<void> {
    const delay: number = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(delay * 2, this.options.retryMaxMs);
    await new Promise<void>((resolve) => {
      this.sleepWake = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = undefined;
        this.sleepWake = undefined;
        resolve();
      }, delay);
    });
  }

  /** Settle a pending bootstrap successfully (first finished round). */
  private settleBootstrapSuccess(): void {
    if (this.bootstrapSettled) {
      return;
    }
    this.bootstrapSettled = true;
    if (this.initTimer !== undefined) {
      clearTimeout(this.initTimer);
      this.initTimer = undefined;
    }
    const resolve: (() => void) | undefined = this.bootstrapResolve;
    this.bootstrapResolve = undefined;
    this.bootstrapReject = undefined;
    resolve?.();
  }

  /** Settle a pending bootstrap with a failure (init deadline / stop). */
  private settleBootstrapFailure(err: ApolloError): void {
    if (this.bootstrapSettled) {
      return;
    }
    this.bootstrapSettled = true;
    if (this.initTimer !== undefined) {
      clearTimeout(this.initTimer);
      this.initTimer = undefined;
    }
    const reject: ((error: ApolloError) => void) | undefined = this.bootstrapReject;
    this.bootstrapResolve = undefined;
    this.bootstrapReject = undefined;
    reject?.(err);
  }

  /** Fire `onChange` without awaiting it; callback errors go to onWarning. */
  private fireOnChange(gen: number, changedNamespaces: string[]): void {
    const handler = this.options.onChange;
    if (!handler) {
      return;
    }
    try {
      const result = handler({
        config: this.mergedConfig ?? {},
        changedNamespaces: [...changedNamespaces],
        source: 'server',
      });
      // `onChange` remains typed as void for compatibility, but callers
      // may return a thenable. Capture asynchronous rejection and suppress
      // it after stop()/generation changes.
      void Promise.resolve(result).catch((err: unknown) => {
        if (this.running && this.alive(gen)) {
          this.fireOnWarning(toApolloError(err, 'Apollo watcher error'));
        }
      });
    } catch (err) {
      if (this.running && this.alive(gen)) {
        this.fireOnWarning(toApolloError(err, 'Apollo watcher error'));
      }
    }
  }

  /** Fire `onCacheLoaded`; callback errors are swallowed (never crash the watcher). */
  private fireOnCacheLoaded(): void {
    const handler = this.options.onCacheLoaded;
    if (!handler || this.mergedConfig === undefined) {
      return;
    }
    try {
      const result = handler({ config: this.mergedConfig });
      // Cache callbacks are fire-and-forget; swallow rejected thenables so
      // a listener cannot create an unhandledRejection in the host process.
      void Promise.resolve(result).catch(() => {});
    } catch {
      // A broken cache-loaded listener must not break the watcher.
    }
  }

  /** Fire `onWarning`; listener errors are swallowed (never crash the watcher). */
  private fireOnWarning(err: ApolloError): void {
    const handler = this.options.onWarning;
    if (!handler) {
      return;
    }
    try {
      const result = handler(err);
      // Warning listener failures are intentionally swallowed, including
      // asynchronous rejections, to preserve the loop's failure path.
      void Promise.resolve(result).catch(() => {});
    } catch {
      // A broken warning listener must not break the watcher.
    }
  }
}

/**
 * Create a watcher; equivalent to `new ApolloWatcher(options)` (plan §5.4).
 */
export function createApolloWatcher(options: ApolloWatcherOptions): ApolloWatcher {
  return new ApolloWatcher(options);
}
