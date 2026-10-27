# apollo-config-client

**English** | [简体中文](https://github.com/liuleiyu121520/apollo-config-client/blob/main/README.zh-CN.md)

Apollo (Ctrip) configuration center client for Node.js with **accesskey
signature support** — a drop-in replacement for
[node-apollo](https://code.aliyun.com/ecarx-web/node-apollo) with zero
runtime dependencies.

When an Apollo environment (server ≥ 1.6.0) has an access key enabled,
unsigned requests to `/configs` are rejected with HTTP 401. This package
signs every config request exactly like the official Java client
(`apollo-core` / `apollo-client` 2.4.0 protocol), while keeping the
well-known `node-apollo` API.

> Tested on Node 22 (darwin arm64 / linux x64). Declared engine range:
> `node >= 18`.

## Installation

```bash
npm install apollo-config-client
```

## Quick start

### Drop-in migration from node-apollo

If you already use `node-apollo`, changing the package name is enough —
same function names, same parameter structure:

```js
// The only change: the package name in the require line.
// const apollo = require('node-apollo');
const apollo = require('apollo-config-client');

const config = {
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: ['application', 'fx.apollo'],
  // clientIp: '10.0.0.1',   // optional
  // releaseKey: '',         // optional
};
const result = await apollo.remoteConfigServiceSkipCache(config);
```

### Enable the accesskey signature

Signature kicks in automatically as soon as a secret resolves through
the resolution chain below. The fastest way is the explicit option:

```js
const { remoteConfigServiceSkipCache } = require('apollo-config-client');

const result = await remoteConfigServiceSkipCache({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: ['application'],
  secret: 'your-apollo-access-key-secret', // additive option
});
```

### Single namespace with precise 304 semantics

```js
const { queryConfig } = require('apollo-config-client');

const config = await queryConfig({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: 'application',
  releaseKey: previousReleaseKey,
  secret: 'your-apollo-access-key-secret',
});
if ('notModified' in config) {
  // HTTP 304: configuration unchanged, keep your existing value.
} else {
  // config.configurations, config.releaseKey, ...
}
```

## Configuring the secret (three supported ways)

The secret is resolved once per request through this chain; the first
non-blank value wins and blank values fall through:

| Priority | Method | Detail |
| --- | --- | --- |
| 1 | Explicit option | `secret` field of the config object |
| 2 | Environment variable | `APOLLO_ACCESSKEY_SECRET` (**legacy name, primary**) |
| 3 | Environment variable | `APOLLO_ACCESS_KEY_SECRET` (new official name, compatibility) |
| 4 | Properties file | see below |

> **When both environment variables are set, the legacy name
> `APOLLO_ACCESSKEY_SECRET` wins.** This intentionally differs from the
> Apollo Java client's official precedence (new name first); it follows
> this package's target user base legacy convention. Keep only one of
> the two variables set if you want to avoid ambiguity.

### Properties file

Path resolution: the `propertiesPath` option, otherwise
`<process.cwd()>/apollo-accesskey.properties`. A missing or unreadable
file is treated as empty (never throws).

Key rules — per-environment keys win over suffix-less keys; when no
`env` is given (option `env` > `process.env.APOLLO_ENV`) only
suffix-less keys are matched:

```properties
# apollo-accesskey.properties
apollo.accesskey.secret.dev=dev-secret-aaaaaaaaaaaaaaaa
apollo.accesskey.secret.prod=prod-secret-bbbbbbbbbbbbbbbb

# suffix-less fallback keys (matched when no env is provided,
# or when no per-env key exists for the active env)
apollo.accesskey.secret=fallback-secret-cccccccccccccccc

# new-style key names are also accepted as fallbacks
apollo.access-key.secret=fallback-secret-dddddddddddddddd
```

```js
await remoteConfigServiceSkipCache({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: 'application',
  env: 'dev',                       // or rely on APOLLO_ENV
  // propertiesPath: '/etc/apollo/accesskey.properties',
});
```

Properties parser subset: UTF-8 (BOM stripped), `#` / `!` comments,
`=` or `:` separators, keys and values trimmed. Continuation lines and
unicode escapes are **not** supported. Duplicate keys use the last value.
When every layer yields nothing, requests are sent **without** signature
headers (unsigned mode keeps
working against environments without accesskey).

## Signature protocol

Aligned field-by-field with the Apollo Java client 2.4.0
(`Signature.java`, `HmacSha1Utils.java`):

- Headers: `Authorization: Apollo {appId}:{signature}` and
  `Timestamp: {millisecond epoch}`.
- `signature = Base64(HmacSHA1(secret, timestamp + "\n" + pathWithQuery))`
  with UTF-8 encoding; `pathWithQuery` is the URL path plus, when
  non-empty, `?` + the raw query string.
- Signed endpoints: `/configs/{appId}/{cluster}/{namespace}` and
  `/configfiles/json/{appId}/{cluster}/{namespace}`.

Fixed protocol vector (covered by the test suite):

```text
secret        = test-secret-0123456789abcdef
timestamp     = 1700000000000
pathWithQuery = /configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1
signature     = dz4F7eaG+5I5PiWjETCC4+HcLjM=
```

You can also use the toolkit directly:

```js
const { signature, buildHttpHeaders, url2PathWithQuery } = require('apollo-config-client');

signature('1700000000000',
  '/configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1',
  'test-secret-0123456789abcdef');
// => 'dz4F7eaG+5I5PiWjETCC4+HcLjM='
```

## Long polling (watcher): config hot updates

The package ships `ApolloWatcher`, a long-polling watcher
over the signed `/notifications/v2` endpoint (the same signature
protocol; the mechanism is derived from
[@lvgithub/ctrip-apollo-client](https://github.com/lvgithub/ctrip-apollo-client)
and aligned with the Apollo Java client):

```js
const { createApolloWatcher } = require('apollo-config-client');

const watcher = createApolloWatcher({
  configServerUrl: 'http://apollo.example.com', // or metaServerUrl, see below
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: ['application', 'fx.apollo'],
  secret: 'your-apollo-access-key-secret',
  onChange: ({ config, changedNamespaces }) => {
    // `config` is the FULL merged flat configuration after the change.
    console.log('changed:', changedNamespaces, 'db.url =', config['db.url']);
  },
  onWarning: (err) => { /* recoverable failures (network, HTTP, cache I/O) */ },
  onCacheLoaded: ({ config }) => { /* recovered from the local cache at start */ },
});

await watcher.start();          // resolves after the first round (or cache recovery)
watcher.getConfig();            // full merged config, or undefined before first data
watcher.isRunning();            // true while the polling loop is alive
watcher.stop();                 // reclaims everything; the watcher can start again
```

Behavior:

- Initial bootstrap uses notificationId `-1` (Java protocol), so the
  first successful round delivers the current configuration through the
  normal 200 → refetch → `onChange` path.
- **Timeouts are mandatory** (this deliberately differs from the upstream
  no-timeout implementation): the long poll read timeout defaults to
  `90000` ms — deliberately longer than the ~60 s server hold
  (`longPollTimeoutMs`); refetches use `timeoutMs` (default 5000);
  `start()` bootstrap is bounded by `initTimeoutMs` (default 10000).
  If the bootstrap does not complete in time, `start()` rejects with an
  `ApolloError` while the watcher keeps retrying in the background.
- Failures never crash the loop: each failed round reports through
  `onWarning` and sleeps with an exponential backoff
  (`retryInitialMs` ×2 capped at `retryMaxMs`, defaults 1000 → 120000,
  reset to the initial delay after every successful round).
- `stop()` aborts every in-flight long poll / refetch / discovery
  request, clears the backoff timer and resets the notification ids —
  no dangling timers or sockets, and the watcher can be started again.
- `onChange` receives the full merged configuration; a throwing
  callback never interrupts the polling loop (the error surfaces through
  `onWarning`).
- Options: `longPollTimeoutMs?` (90000) / `initTimeoutMs?` (10000) /
  `retryInitialMs?` (1000) / `retryMaxMs?` (120000) /
  `discoveryRefreshMs?` (60000) / `cachePath?` / `onChange?` /
  `onWarning?` / `onCacheLoaded?`.

## Local cache

Every successful refetch is persisted to a local JSON file and recovered
when the process restarts while the server is unreachable (mechanism
derived from @lvgithub, hardened):

- Default path:
  `<cwd>/.apollo-config-client-cache/{appId}.{clusterName}.{isolation}.json`.
  The 10-char `isolation` key is
  `sha256(uniqueBaseUrl + "\n" + JSON.stringify(sorted namespaces)).slice(0,10)`,
  where `uniqueBaseUrl` is the validated unique configured address
  (`configServerUrl`, or `metaServerUrl` when discovery is used).
  Watchers with the same appId + cluster but different servers therefore
  never share a cache file; watchers sharing a meta server intentionally
  share a cache domain (dynamic instance addresses are not part of the
  key).
- The `appId` and `clusterName` filename components are percent-encoded
  (literal dots become `%2E`), preventing path traversal and delimiter
  collisions. The watcher ignores a cache whose stored `appId` or
  `clusterName` does not match the current options. An explicit version
  other than numeric `1` is ignored; a missing version remains supported
  for compatibility.
- Writes are atomic (same-directory temp file + `rename`), so an
  interrupted write can never leave a half-written cache.
- A corrupted or unreadable cache file is treated as "no cache" — it
  never throws.
- `cachePath: '<file>'` overrides the file path; `cachePath: false`
  disables caching entirely.
- The file stores each namespace's `configurations` (flat — dotted keys
  are NOT expanded into nested objects) and its `releaseKey`.

## Grayscale IP

`/configs`, `/configfiles/json` and `/notifications/v2` carry an `ip=`
query parameter for grayscale release:

1. An explicit `clientIp` option always wins.
2. Otherwise the local IPv4 is auto-detected through the built-in
   `node:os` module (zero runtime dependencies — `internal-ip` is
   deliberately not used). Detection happens per request; there is no
   cached value.
3. `autoDetectIp: false` omits the `ip` parameter entirely, matching the
   node-apollo base URLs (useful for byte-stable URL assertions).

## Meta service discovery

Instead of a fixed `configServerUrl` you may configure a
`metaServerUrl`; the base URL is then resolved through the **unsigned**
`GET {metaServerUrl}/services/config?appId=&ip?` flow (the Java
`ConfigServiceLocator` treats this endpoint as unsigned too), picking
one instance's `homepageUrl`:

```js
const { createApolloWatcher, remoteConfigServiceSkipCache } = require('apollo-config-client');

const watcher = createApolloWatcher({
  metaServerUrl: 'http://apollo-meta.example.com', // instead of configServerUrl
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: 'application',
  secret: 'your-apollo-access-key-secret',
  onChange: ({ config }) => { /* ... */ },
});
```

- The resolved address is memoized with a TTL
  (`discoveryRefreshMs`, default 60000) — service list changes are
  picked up, the address is not resolved once and frozen.
- A failed refresh (empty list, network error) keeps the previously
  resolved address and reports through `onWarning`; only when no
  previous address exists does it throw. A network failure of the
  *selected* address invalidates the memo, forcing re-discovery.
- **Mutual exclusion:** `configServerUrl` and `metaServerUrl` are
  mutually exclusive — configuring both throws
  `ApolloError("configServerUrl and metaServerUrl are mutually
  exclusive, configure exactly one")`. The rule applies to
  `remoteConfigServiceSkipCache`, `remoteConfigServiceFromCache`,
  `queryConfig` and the watcher. **Exemption:** the OpenApi entry
  `remoteConfigService` (token-based inheritance surface) does not
  consume `metaServerUrl` and does not participate in the check.
- When no `metaServerUrl` is configured, the explicit `configServerUrl`
  is used directly (node-apollo base behavior, unchanged).

## Multiple instances

Instances are fully independent — there is no global singleton state
(upstream's `global._apollo` is deliberately not copied). You can run
several watchers in one process (different appIds, clusters, servers or
meta servers); each keeps its own notification ids, cache file
(isolation-keyed), abort controller and callbacks:

```js
const w1 = createApolloWatcher({ appId: 'app-one', configServerUrl: 'http://s1', /* ... */ });
const w2 = createApolloWatcher({ appId: 'app-two', configServerUrl: 'http://s2', /* ... */ });
await w1.start();
await w2.start();
```

## 304 semantics

- `queryConfig` resolves `{ notModified: true }` on HTTP 304.
- `remoteConfigServiceSkipCache` / `remoteConfigServiceFromCache`
  resolve `null` when **every** namespace answers 304, meaning "keep
  the existing configuration". With a mix of 200 and 304 responses,
  only the 200 payloads are merged. 304 is never an error.

## 401 troubleshooting

`HTTP 401` raises `ApolloUnauthorizedError` (no automatic retry) with a
message pointing to the three secret methods. Checklist:

1. Is an access key actually enabled for that Apollo environment?
2. Does the secret resolve through one of the three supported ways
   (explicit option, environment variable, properties file)? Print-free
   check: `require('apollo-config-client').resolveAccessKeySecret()` returns
   the resolved secret or `undefined` — compare it with the Apollo
   console value.
3. Is the client clock NTP synchronized? Signatures carry a millisecond
   timestamp; clock drift can make the server reject valid secrets.

## Error types

| Error | Meaning | Extra fields |
| --- | --- | --- |
| `ApolloError` | Base class (also used for missing parameters) | `url?` |
| `ApolloUnauthorizedError` | HTTP 401, wrong/missing secret | `statusCode`, `appId`, `url` |
| `ApolloHttpError` | Other non-2xx/non-304 status; invalid JSON; 404 adds a "namespace may not be published" hint | `statusCode`, `url` |
| `ApolloNetworkError` | Connection failure or timeout | `url` |

Error messages and fields never contain the secret.

## API

```ts
// Drop-in baseline (node-apollo compatible)
remoteConfigServiceSkipCache(config): Promise<Record<string, string> | null>
remoteConfigServiceFromCache(config): Promise<Record<string, string> | null>
remoteConfigService(config): Promise<Record<string, unknown>>      // OpenApi token passthrough
remoteConfigServiceSikpCache(config)                               // deprecated spelling alias
createEnvFile(envConfig: object, filePath?: string): void          // default ./default.env
setEnv(filePath?: string): void                                    // inject, never overrides existing vars

// Accesskey extensions
queryConfig(config & { namespaceName: string }): Promise<{ notModified: true } | ApolloConfig>
signature(timestamp: string, pathWithQuery: string, secret: string): string
buildHttpHeaders(url: string, appId: string, secret: string): { Authorization: string; Timestamp: string }
url2PathWithQuery(url: string): string
resolveAccessKeySecret(input?: { secret?: string; env?: string; propertiesPath?: string }): string | undefined

// mechanism extensions
createApolloWatcher(options): ApolloWatcher                        // = new ApolloWatcher(options)
watcher.start(): Promise<void>                                     // idempotent; bounded by initTimeoutMs
watcher.stop(): void                                               // full resource reclaim, restartable
watcher.getConfig(): Record<string, string> | undefined
watcher.isRunning(): boolean
detectLocalIpv4(): string | undefined                              // node:os, no module-level memo
invalidateDiscoveryCache(): void                                   // drop the meta discovery TTL memo
defaultCachePath(input): string                                    // isolation-keyed default cache file path
```

`config` fields: `configServerUrl` (or `metaServerUrl`; exactly one —
the OpenApi entry `remoteConfigService` is exempt), `appId`,
`clusterName`, `namespaceName` (string or array; an empty array falls
back to `application`), `releaseKey?`, `clientIp?` (explicit grayscale
IP), `autoDetectIp?` (default `true`; `false` disables attaching a
detected IP), `discoveryRefreshMs?` (default 60000), plus the additive
`secret?`, `propertiesPath?`, `env?`, `dataCenter?`, `timeoutMs?`
(default 5000).

## Behavioral differences vs node-apollo@1.2.1

All intentional improvements for the drop-in path:

1. Missing (or empty) `releaseKey` / `clientIp` / `dataCenter` no longer
   produce `?releaseKey=undefined&ip=undefined` fragments.
2. `configServerUrl` trailing slashes are normalized; path segments
   (`appId` / `clusterName` / `namespaceName`) are percent-encoded with
   `encodeURIComponent` (the base had no escaping). Identical URLs for
   common ASCII values.
3. HTTP 304 is no longer an error; see the 304 contract above.
4. 401 / 404 / network failures raise structured error classes instead
   of bare assertions. `remoteConfigService` keeps the base message
   wording.
5. `createEnvFile` / `setEnv` write to `process.cwd()/default.env`
   instead of the package's own (read-only at install time) directory;
   an optional `filePath` parameter is available.
6. `setEnv` uses a built-in minimal `.env` parser (`KEY=VALUE`, `#`
   comments, trimming, never overrides existing variables) instead of
   dotenv@4. Quote stripping and variable expansion are not supported.
   Repeated keys use the last occurrence.
   When the file is missing or unreadable, `setEnv` silently does
   nothing.
7. Empty-array `namespaceName` still falls back to `application`; the
   `remoteConfigServiceSikpCache` spelling alias is kept (deprecated).
8. TLS certificate verification is enabled (Node default). The base
   disabled it via urllib's `rejectUnauthorized: false`. For intranet
   servers with custom CAs, add them via `NODE_EXTRA_CA_CERTS`.
9. Every request carries a timeout (default 5000 ms, `timeoutMs`
   option) instead of waiting forever; zero runtime dependencies
   (urllib@2 and dotenv@4 removed).
10. When no explicit `clientIp` is configured, an auto-detected local
    IPv4 (`node:os`) is attached as the `ip` query parameter to every
    request (grayscale support). `autoDetectIp: false` restores the
    exact node-apollo base URLs. Explicit `clientIp` values behave
    identically to the base package.

## Migrating from @lvgithub/ctrip-apollo-client

Capability mapping (mechanism-level parity, API names differ):

| Upstream | This package |
| --- | --- |
| `new CtripApolloClient(option)` + `ready()` | `createApolloWatcher(options)` + `await watcher.start()` |
| `stop()` | `watcher.stop()` (now also aborts in-flight requests and is restartable) |
| `getConfigs()` | `watcher.getConfig()` |
| `onChange(cb)` | `onChange` option (`{ config, changedNamespaces, source }`) |
| `getValue` / `hotValue` / `withValue` / decorators | intentionally not provided (implementation style, not capability); read `watcher.getConfig()` instead |
| `configPath` | `cachePath` (string file path, or `false` to disable; default is isolation-keyed) |
| `initTimeoutMs` | `initTimeoutMs` (default 10000) |
| meta discovery | `metaServerUrl` (with TTL refresh and failure fallback, see above) |
| `accessKey` | `secret` (plus the full three-way resolution chain) |
| `global._apollo` singleton | not copied: instances are independent |

## Roadmap

- Per-appId secret override
  (`apollo.accesskey.{appId}.secret`, Java semantics) — not in the
  first release.

## Acknowledgements

This package is an incremental extension (derivative work) of existing
open-source projects; thanks to their authors:

- Based on and API-compatible with
  [node-apollo@1.2.1](https://code.aliyun.com/ecarx-web/node-apollo)
  (ISC license, author Quinton.xu, Quinton.xu@gmail.com) — reuse scope:
  the public API surface and code structure (function names, parameter
  shapes, URL-construction layout and merge semantics).
- Signature, long polling, local caching, grayscale IP detection, meta
  service discovery and change callbacks derived from
  [@lvgithub/ctrip-apollo-client@1.0.38](https://github.com/lvgithub/ctrip-apollo-client)
  (MIT license) — reuse scope: the signing module technique
  (`createHmac('sha1')`, `\n`-joined signing string, base64, `new URL`
  path/query extraction) and the mechanisms of the five feature modules
  listed above (each derived source file documents its
  deviations; deliberate non-copies include the no-timeout requests,
  the `global._apollo` global singleton and dotted-key expansion).
- Protocol basis: the Apollo Java client
  (`apollo-core` / `apollo-client` 2.4.0, Apache-2.0).

The complete upstream license texts and copyright notices are preserved
in [THIRD-PARTY-NOTICES.md](https://github.com/liuleiyu121520/apollo-config-client/blob/main/THIRD-PARTY-NOTICES.md); derivation notes
also appear in the headers of the derived source files.

## License

[MIT](https://github.com/liuleiyu121520/apollo-config-client/blob/main/LICENSE). Upstream notices: [THIRD-PARTY-NOTICES.md](https://github.com/liuleiyu121520/apollo-config-client/blob/main/THIRD-PARTY-NOTICES.md).
