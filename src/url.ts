/** Shared URL helpers used by the client, discovery, cache and watch modules. */

/** Strip every trailing slash from a base URL. */
export function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
