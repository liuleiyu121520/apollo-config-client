/**
 * Local IPv4 auto-detection for grayscale release (`ip=` query
 * parameter).
 *
 * DERIVATION NOTICE (MIT upstream source):
 * - Upstream: @lvgithub/ctrip-apollo-client@1.0.38, MIT license,
 *   Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors,
 *   https://github.com/lvgithub/ctrip-apollo-client
 *   (src/index.js:66-69: the mechanism of attaching a local IPv4 to
 *   every config request, obtained there through the `internal-ip`
 *   runtime dependency). This module re-implements the *mechanism*
 *   with the Node built-in `node:os` module only: zero runtime
 *   dependencies is a hard baseline of this package (PRD FR-10.3 /
 *   NFR-1; `internal-ip` is explicitly forbidden). Java alignment:
 *   `ConfigUtil.getLocalIp()` (Java client attaches the local IP to
 *   long-poll and config URLs the same way).
 * - Deliberately NOT copied from upstream (copy-forbidden list):
 *   no module-level memo of the detected address (every call
 *   enumerates interfaces afresh, so long-running processes pick up
 *   network changes), and no asynchronous promise chain racing the
 *   first requests (the watcher resolves the IP synchronously per
 *   request round).
 */

import { networkInterfaces } from 'node:os';

/**
 * Detect the first non-internal IPv4 address of this machine by
 * enumerating `node:os` network interfaces.
 *
 * - Every call enumerates the interfaces directly; there is NO
 *   module-level cache (per plan DF-18 the discovery TTL memo is the
 *   only module-level cache in this package).
 * - Interface iteration order follows `os.networkInterfaces()` key
 *   order as reported by the OS; the first non-internal IPv4 wins.
 * - Any failure (enumeration error, unexpected entry shapes) returns
 *   `undefined`; this function never throws.
 *
 * @returns the detected IPv4 address string, or `undefined`.
 */
export function detectLocalIpv4(): string | undefined {
  try {
    const nets: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]> = networkInterfaces();
    for (const name of Object.keys(nets)) {
      const addrs: import('node:os').NetworkInterfaceInfo[] | undefined = nets[name];
      if (!Array.isArray(addrs)) {
        continue;
      }
      for (const addr of addrs) {
        if (addr.internal) {
          continue;
        }
        // Node >= 18 reports `family` as the string 'IPv4' | 'IPv6'.
        if (addr.family !== 'IPv4') {
          continue;
        }
        const ip: string = addr.address;
        if (typeof ip === 'string' && ip.length > 0) {
          return ip;
        }
      }
    }
    return undefined;
  } catch {
    // Detection failure must never break a config request: the caller
    // simply omits the `ip` query parameter.
    return undefined;
  }
}
