/**
 * Access key secret resolution and the shared key=value text parsing
 * kernel.
 *
 * No upstream source: new capability added on top of the node-apollo
 * base (the base's dotenv dependency is removed, see README behavioral
 * differences). The parsing kernel below is reused by the `.env`
 * injection in compat.ts.
 *
 * Secret resolution chain (first non-blank value wins, trimmed):
 *   1. explicit `secret` option;
 *   2. environment variable APOLLO_ACCESSKEY_SECRET (legacy, primary);
 *   3. environment variable APOLLO_ACCESS_KEY_SECRET (new name,
 *      compatibility; when both are set the legacy name wins);
 *   4. properties file.
 *
 * Properties keys checked, in order:
 *   apollo.accesskey.secret.{env} > apollo.access-key.secret.{env} >
 *   apollo.accesskey.secret       > apollo.access-key.secret
 * `env` comes from the `env` option, falling back to
 * `process.env.APOLLO_ENV`; without an env only the suffix-less keys
 * are matched. A missing or unreadable properties file is treated as
 * empty and never throws. When every layer yields nothing, the
 * function returns `undefined` and the client sends the request
 * unsigned.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ResolveAccessKeySecretInput {
  /** Layer 1: explicit secret from the caller config object. */
  secret?: string;
  /** Environment name for properties lookup; falls back to APOLLO_ENV. */
  env?: string;
  /** Layer 4: explicit properties file path. */
  propertiesPath?: string;
}

const DEFAULT_PROPERTIES_FILE_NAME = 'apollo-accesskey.properties';

/**
 * Minimal `key=value` text parser shared by the properties reader and
 * the `.env` injector. Supported subset: UTF-8 content with BOM
 * stripping, `#` / `!` comment lines, blank lines, `=` or `:` as the
 * key/value separator (first occurrence), and trimming of keys and
 * values. Continuation lines and unicode escapes are NOT supported
 * (documented in README). Lines without a separator are ignored.
 *
 * @param content - raw file content.
 * @returns a plain object mapping keys to trimmed values.
 */
export function parseKeyValueText(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let text: string = content;
  // Strip a leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const lines: string[] = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line: string = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const eqIndex: number = line.indexOf('=');
    const colonIndex: number = line.indexOf(':');
    let separatorIndex: number = -1;
    if (eqIndex >= 0 && colonIndex >= 0) {
      separatorIndex = Math.min(eqIndex, colonIndex);
    } else if (eqIndex >= 0) {
      separatorIndex = eqIndex;
    } else {
      separatorIndex = colonIndex;
    }
    if (separatorIndex <= 0) {
      continue;
    }
    const key: string = line.slice(0, separatorIndex).trim();
    const value: string = line.slice(separatorIndex + 1).trim();
    if (key.length === 0) {
      continue;
    }
    // Define an own data property instead of assigning through the
    // prototype. This keeps ordinary-object behavior for duplicate keys
    // (the last value wins, like dotenv/Properties) while making keys
    // such as `__proto__`, `constructor` and `toString` data values rather
    // than prototype setters or inherited members.
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return result;
}

/**
 * Read and parse a properties file. A missing or unreadable file is
 * treated as empty (no throw), so a codebase without the secret file
 * keeps working in unsigned mode.
 *
 * @param filePath - absolute or cwd-relative properties file path.
 * @returns parsed key/value map, or an empty object.
 */
function readPropertiesFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return {};
    }
    const content: string = fs.readFileSync(filePath, 'utf8');
    return parseKeyValueText(content);
  } catch {
    // Missing/unreadable file is treated as empty per plan DF-6.
    return {};
  }
}

/**
 * Resolve the access key secret through the full four-layer chain.
 * Returns the trimmed secret, or `undefined` when every layer is
 * blank/absent (the caller then sends the request without signature
 * headers).
 *
 * @param input - optional per-call overrides (secret / env /
 *   propertiesPath).
 */
export function resolveAccessKeySecret(
  input?: ResolveAccessKeySecretInput
): string | undefined {
  const options: ResolveAccessKeySecretInput = input ?? {};

  // Layer 1: explicit option.
  if (typeof options.secret === 'string' && options.secret.trim().length > 0) {
    return options.secret.trim();
  }

  // Layer 2: legacy environment variable (primary).
  const legacyEnv: string | undefined = process.env.APOLLO_ACCESSKEY_SECRET;
  if (typeof legacyEnv === 'string' && legacyEnv.trim().length > 0) {
    return legacyEnv.trim();
  }

  // Layer 3: new-name environment variable (compatibility).
  const newEnv: string | undefined = process.env.APOLLO_ACCESS_KEY_SECRET;
  if (typeof newEnv === 'string' && newEnv.trim().length > 0) {
    return newEnv.trim();
  }

  // Layer 4: properties file.
  const propertiesPath: string =
    typeof options.propertiesPath === 'string' && options.propertiesPath.trim().length > 0
      ? options.propertiesPath
      : path.resolve(process.cwd(), DEFAULT_PROPERTIES_FILE_NAME);
  const properties: Record<string, string> = readPropertiesFile(propertiesPath);

  // Environment name for suffixed keys: option > APOLLO_ENV.
  const envName: string | undefined =
    typeof options.env === 'string' && options.env.trim().length > 0
      ? options.env.trim()
      : process.env.APOLLO_ENV;

  const candidates: string[] = [];
  if (typeof envName === 'string' && envName.length > 0) {
    candidates.push(`apollo.accesskey.secret.${envName}`);
    candidates.push(`apollo.access-key.secret.${envName}`);
  }
  candidates.push('apollo.accesskey.secret');
  candidates.push('apollo.access-key.secret');

  for (const key of candidates) {
    const value: string | undefined = properties[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
