/**
 * Local file cache for fetched Apollo namespaces (crash / outage
 * recovery).
 *
 * DERIVATION NOTICE (MIT upstream source):
 * - Upstream: @lvgithub/ctrip-apollo-client@1.0.38, MIT license,
 *   Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors,
 *   https://github.com/lvgithub/ctrip-apollo-client
 *   (src/index.js:249-295 `saveConfigsToFile` / `readConfigsFromFile`:
 *   the mechanism of persisting fetched namespace payloads to a local
 *   JSON file and recovering from it when the server is unreachable).
 *   Full license text is preserved in THIRD-PARTY-NOTICES.md section 2.
 * - Deliberately NOT copied from upstream (copy-forbidden list):
 *   the dotted-key expansion into nested objects (`set(configurations,
 *   key, ...)` — configurations stay flat here), the plain
 *   `fs.writeFileSync` (replaced by same-directory tmp file + rename,
 *   so an interrupted write can never leave a half-written cache), the
 *   throwing `JSON.parse` on a corrupted file (replaced by
 *   "corrupted means no cache"), and the single shared `configPath`
 *   (replaced by an isolation key that mixes the unique configured
 *   base URL and the sorted namespace list into the file name, so
 *   multi-instance watchers never share a cache file).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeBase } from './url';

/** Cache schema version written into every cache file. */
const CACHE_FILE_VERSION = 1 as const;

/** Default cache directory, resolved against `process.cwd()`. */
export const DEFAULT_CACHE_DIR_NAME = '.apollo-config-client-cache';

/** One namespace's persisted payload (flat configurations, no dot expansion). */
export interface CacheNamespaceEntry {
  /** releaseKey of the last successful fetch, when the payload carried one. */
  releaseKey?: string;
  /** Flat key/value configurations of the namespace. */
  configurations: Record<string, unknown>;
}

/** Full on-disk cache file content. */
export interface CacheFileContent {
  version: typeof CACHE_FILE_VERSION;
  appId: string;
  clusterName: string;
  namespaces: Record<string, CacheNamespaceEntry>;
}

/** Input for `defaultCachePath`. */
export interface DefaultCachePathInput {
  appId: string;
  clusterName: string;
  /** Namespace list of the watcher/entry (deduplicated before hashing). */
  namespaces: string[];
  /**
   * The unique configured address AFTER the configServerUrl /
   * metaServerUrl mutual-exclusion check, trailing slash stripped.
   * Dynamic discovery instance addresses are NOT part of the key:
   * watchers sharing the same meta server intentionally share a cache
   * domain (plan DF-17).
   */
  uniqueBaseUrl: string;
}

/**
 * Compute the cache isolation key:
 * `sha256(uniqueBaseUrl + "\n" + JSON.stringify(sorted unique namespaces)).slice(0, 10)`.
 *
 * The unique configured base URL makes caches of the same
 * appId+cluster against different servers independent; the sorted
 * namespace list makes the key order-insensitive.
 *
 * @returns the first 10 hex characters of the SHA-256 digest.
 */
export function computeIsolationKey(uniqueBaseUrl: string, namespaces: string[]): string {
  const base: string = normalizeBase(uniqueBaseUrl);
  const sorted: string[] = Array.from(new Set(namespaces)).sort();
  return createHash('sha256')
    .update(`${base}\n${JSON.stringify(sorted)}`, 'utf8')
    .digest('hex')
    .slice(0, 10);
}

/**
 * Default cache file path:
 * `<cwd>/.apollo-config-client-cache/{appId}.{clusterName}.{isolation}.json`.
 *
 * @param input - identity parts; `uniqueBaseUrl` must be the validated
 *   unique configured address (mutual-exclusion check is the caller's
 *   duty and is enforced again by the watcher constructor).
 */
export function defaultCachePath(input: DefaultCachePathInput): string {
  const isolation: string = computeIsolationKey(input.uniqueBaseUrl, input.namespaces);
  const dir: string = path.resolve(process.cwd(), DEFAULT_CACHE_DIR_NAME);
  // Encode each identity component before joining it into the filename.
  // `encodeURIComponent` removes path separators, while encoding literal
  // dots as well keeps the `appId.clusterName` delimiter unambiguous (for
  // example, `a.b` + `c` cannot collide with `a` + `b.c`).
  const encodedAppId: string = encodeURIComponent(input.appId).replace(/\./g, '%2E');
  const encodedClusterName: string = encodeURIComponent(input.clusterName).replace(/\./g, '%2E');
  return path.join(dir, `${encodedAppId}.${encodedClusterName}.${isolation}.json`);
}

/**
 * Load a cache file. Any problem (missing file, unreadable, invalid
 * JSON, unexpected shape, zero usable namespaces) is treated as "no
 * cache": the function returns `undefined` and NEVER throws (plan
 * FR-9.3 corrupted-file tolerance).
 *
 * @param filePath - absolute or cwd-relative cache file path.
 */
export function loadConfigCache(filePath: string): CacheFileContent | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return undefined;
    }
    const raw: string = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const obj = parsed as {
      version?: unknown;
      namespaces?: unknown;
      appId?: unknown;
      clusterName?: unknown;
    };
    // Cache documents without a version field remain accepted as the
    // supported compatibility format. Once present, however, the version
    // is a strict schema discriminator: unknown versions must not be parsed
    // as the current shape.
    if (
      Object.prototype.hasOwnProperty.call(obj, 'version') &&
      obj.version !== CACHE_FILE_VERSION
    ) {
      return undefined;
    }
    if (obj.namespaces === null || typeof obj.namespaces !== 'object' || Array.isArray(obj.namespaces)) {
      return undefined;
    }
    const namespaces: Record<string, CacheNamespaceEntry> = {};
    for (const [ns, entry] of Object.entries(obj.namespaces as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as { releaseKey?: unknown; configurations?: unknown };
      if (
        candidate.configurations === null ||
        typeof candidate.configurations !== 'object' ||
        Array.isArray(candidate.configurations)
      ) {
        continue;
      }
      // `__proto__` is a valid Apollo namespace name. Define an own data
      // property instead of assigning through Object.prototype's setter,
      // while retaining the ordinary object shape exposed to callers.
      Object.defineProperty(namespaces, ns, {
        value: {
          releaseKey:
            typeof candidate.releaseKey === 'string' ? candidate.releaseKey : undefined,
          configurations: candidate.configurations as Record<string, unknown>,
        },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (Object.keys(namespaces).length === 0) {
      return undefined;
    }
    return {
      version: CACHE_FILE_VERSION,
      appId: typeof obj.appId === 'string' ? obj.appId : '',
      clusterName: typeof obj.clusterName === 'string' ? obj.clusterName : '',
      namespaces,
    };
  } catch {
    // Corrupted / unreadable cache means "no cache" (plan FR-9.3).
    return undefined;
  }
}

/**
 * Atomically write a cache file: the content is written to a
 * same-directory temporary file first and then `rename`d over the
 * target, so a crash or interruption can never leave a half-written
 * cache in place of the previous valid one (plan FR-9.3 / DF-17).
 *
 * The parent directory is created recursively when missing. On any
 * write/rename failure the temporary file is removed best-effort and
 * the error is rethrown; callers decide how to surface it (the watcher
 * reports write failures through `onWarning` only).
 *
 * @param filePath - target cache file path.
 * @param content - full cache content to persist.
 */
export function writeConfigCacheAtomic(filePath: string, content: CacheFileContent): void {
  const dir: string = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath: string = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(content, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Cleanup is best-effort; the original error is the one that matters.
    }
    throw err;
  }
}
