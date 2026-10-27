/**
 * Base-package inheritance surface (drop-in compatibility layer).
 *
 * DERIVATION NOTICE (ISC upstream source):
 * - Upstream: node-apollo@1.2.1, ISC license,
 *   Copyright (c) 2018 Quinton.xu <Quinton.xu@gmail.com>,
 *   https://code.aliyun.com/ecarx-web/node-apollo.
 * - `remoteConfigService` derives from `lib/apollo.js:11-27` and
 *   `toJSON` / `mergeConfig` / `_itemsPick` from `lib/helper.js:7-55`:
 *   semantics are preserved (OpenApi token passthrough, public/private
 *   merge order, JSON-detection heuristic), only error handling is
 *   replaced by structured error classes while keeping the base
 *   message wording.
 * - `createEnvFile` / `setEnv` derive from `lib/apollo.js:90-107`.
 *   The dotenv@^4 dependency is replaced by the built-in key=value
 *   parser (see src/secret.ts); the injection semantic follows
 *   dotenv@4.0.0 (`lib/main.js:63`:
 *   `process.env[key] = process.env[key] || parsedObj[key]`, i.e.
 *   existing environment variables are never overridden). The file
 *   location moved from the package's own directory
 *   (config.js ENV_FILE_PATH, unusable inside read-only installs) to
 *   `process.cwd()/default.env`; the call style is unchanged and
 *   `filePath` is an optional extension. When the file is missing or
 *   unreadable, `setEnv` silently does nothing (matching dotenv@4
 *   semantics, which reports errors in its result instead of throwing).
 * Full license text is preserved in THIRD-PARTY-NOTICES.md section 1.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ApolloClientOptions,
  mergeFlatConfigurations,
  remoteConfigServiceSkipCache,
} from './client';
import { ApolloError, ApolloHttpError } from './errors';
import { httpGet } from './http';
import { parseKeyValueText } from './secret';

const DEFAULT_ENV_FILE_NAME = 'default.env';

/**
 * Options accepted by the OpenApi compatibility entry point. OpenApi does
 * not address a namespace, so `namespaceName` is optional here even though
 * it remains required by the config-service entry points.
 */
export interface ApolloOpenApiOptions extends Omit<ApolloClientOptions, 'namespaceName'> {
  configServerUrl: string;
  namespaceName?: ApolloClientOptions['namespaceName'];
  apolloEnv?: string;
  token: string;
}

/** OpenApi payload item as returned by the Apollo open platform. */
interface OpenApiNamespaceMeta {
  isPublic?: boolean;
  items?: Array<{ key?: string; value?: string }>;
}

/**
 * Port of node-apollo `helper.toJSON`: returns the parsed value when
 * the string looks like JSON, otherwise the original string.
 * The heuristic is kept verbatim (semantics preserved).
 */
function toJSON(str: string): string | Record<string, unknown> | Array<unknown> | number | boolean | null {
  if (
    /^[\],:{}\s]*$/.test(
      str
        .replace(/\\["\\\/bfnrtu]/g, '@')
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
        .replace(/(?:^|:|,)(?:\s*\[)+/g, '')
    )
  ) {
    return JSON.parse(str);
  }
  return str;
}

/** Pick `key` → `toJSON(value)` pairs out of one namespace's items. */
function itemsPick(
  items: Array<{ key?: string; value?: string }>,
  context: { toJSON: (str: string) => unknown }
): Array<Record<string, unknown>> {
  const ret: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, item.key as string, {
      configurable: true,
      enumerable: true,
      value: context.toJSON(item.value as string),
      writable: true,
    });
    ret.push(obj);
  }
  return ret;
}

/**
 * Port of node-apollo `helper.mergeConfig`: merges the OpenApi
 * namespace list into a flat object. Public items are applied after
 * private items, so public keys win for duplicates (base semantics).
 */
function mergeConfig(payload: OpenApiNamespaceMeta[]): Record<string, unknown> {
  if (!Array.isArray(payload)) {
    throw new ApolloError('Apollo config should be an array');
  }
  const publicPayload: Array<Record<string, unknown>> = [];
  const privatePayload: Array<Record<string, unknown>> = [];
  for (const meta of payload) {
    if (meta.isPublic) {
      publicPayload.push(...itemsPick(meta.items ?? [], { toJSON }));
    } else {
      privatePayload.push(...itemsPick(meta.items ?? [], { toJSON }));
    }
  }
  // Preserve node-apollo's private-then-public merge order; later public
  // values override duplicates.
  return mergeFlatConfigurations([...privatePayload, ...publicPayload]);
}

/** Build the OpenApi "all namespaces" URL (base helper.js:76-84 wording kept). */
function getAllConfigFromApolloUri(config: ApolloOpenApiOptions): string {
  if (!config.configServerUrl) {
    throw new ApolloError('configServerUrl is required');
  }
  if (!config.appId) {
    throw new ApolloError('appId is required');
  }
  if (!config.clusterName) {
    throw new ApolloError('clusterName is required');
  }
  return (
    `${config.configServerUrl}/openapi/v1/envs/${config.apolloEnv}` +
    `/apps/${config.appId}/clusters/${config.clusterName}/namespaces`
  );
}

/**
 * Read configuration through the Apollo open platform (OpenApi) using
 * an access token. Inherited from node-apollo `remoteConfigService`
 * with identical semantics (same parameter shape, same merge
 * behavior); errors are structured error classes carrying the base
 * message wording.
 *
 * @param config - `{configServerUrl, appId, clusterName, apolloEnv,
 *   token}`; multi-namespace is not supported by this endpoint (base
 *   behavior).
 */
export async function remoteConfigService(
  config: ApolloOpenApiOptions
): Promise<Record<string, unknown>> {
  if (!config) {
    throw new ApolloError('param config is required');
  }
  if (!config.token) {
    throw new ApolloError('param token is required');
  }
  const url: string = getAllConfigFromApolloUri(config);
  const res = await httpGet(url, {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: config.token,
    },
    timeoutMs: config.timeoutMs,
  });
  if (res.statusCode !== 200) {
    // Base message wording preserved (including its original spelling).
    throw new ApolloHttpError(
      'apollo host unavailable, please contact your administrtor',
      res.statusCode,
      url
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(res.body);
  } catch {
    throw new ApolloHttpError(
      `Apollo returned invalid JSON for ${url}`,
      res.statusCode,
      url
    );
  }
  return mergeConfig(payload as OpenApiNamespaceMeta[]);
}

/**
 * DEPRECATED spelling-compat alias kept from node-apollo
 * (`remoteConfigServiceSikpCache`, sic). New code should use
 * `remoteConfigServiceSkipCache`. Behaves identically to it.
 *
 * @param config - see `remoteConfigServiceSkipCache`.
 */
export async function remoteConfigServiceSikpCache(
  config: ApolloClientOptions
): Promise<Record<string, string> | null> {
  return remoteConfigServiceSkipCache(config);
}

/**
 * Write a `default.env` file from a flat object (`key=value` lines).
 * Inherited from node-apollo `createEnvFile`; the file location moved
 * from the package's own directory to `process.cwd()/default.env`
 * (the base wrote into its read-only install directory, which is
 * unusable in practice). The existing file, if any, is removed first.
 *
 * @param envConfig - flat object of environment entries.
 * @param filePath - optional target file path; defaults to
 *   `path.resolve(process.cwd(), 'default.env')`.
 */
export function createEnvFile(envConfig: Record<string, string>, filePath?: string): void {
  if (!envConfig || typeof envConfig !== 'object') {
    throw new ApolloError('param envConfig is required');
  }
  const target: string =
    typeof filePath === 'string' && filePath.length > 0
      ? filePath
      : path.resolve(process.cwd(), DEFAULT_ENV_FILE_NAME);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
  for (const key of Object.keys(envConfig)) {
    fs.appendFileSync(target, `${key}=${envConfig[key]}\n`);
  }
}

/**
 * Load a `.env` file into `process.env` using the built-in parser
 * (dotenv@^4 replacement). Supported subset: `KEY=VALUE` lines, `#`
 * comment lines, blank lines and trimming; quote stripping and
 * variable expansion are NOT supported. Existing environment variables
 * are never overridden (dotenv@4.0.0 semantics:
 * `process.env[key] = process.env[key] || parsed[key]`).
 *
 * When the file is missing or unreadable the function silently does
 * nothing and never throws (matching dotenv@4, which reports load
 * errors in its result instead of throwing).
 *
 * @param filePath - optional source file path; defaults to
 *   `path.resolve(process.cwd(), 'default.env')`.
 */
export function setEnv(filePath?: string): void {
  const target: string =
    typeof filePath === 'string' && filePath.length > 0
      ? filePath
      : path.resolve(process.cwd(), DEFAULT_ENV_FILE_NAME);
  let content: string;
  try {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return;
    }
    content = fs.readFileSync(target, 'utf8');
  } catch {
    // Missing/unreadable file: silently no-op (dotenv@4 semantics).
    return;
  }
  const parsed: Record<string, string> = parseKeyValueText(content);
  for (const key of Object.keys(parsed)) {
    process.env[key] = process.env[key] || parsed[key];
  }
}
