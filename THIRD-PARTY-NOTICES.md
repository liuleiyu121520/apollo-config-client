# Third-Party Notices

This package (`apollo-config-client`) is an incremental extension (derivative
work) built on top of open-source projects and the Apollo Java client
protocol. This file carries the complete original license texts and
copyright notices that must be preserved when redistributing those
upstream works (ISC and MIT both require retaining the original copyright
and license statements).

## 1. node-apollo@1.2.1 (ISC)

- Upstream package: `node-apollo` version 1.2.1
- Author / copyright holder: Quinton.xu (Quinton.xu@gmail.com)
- Upstream repository: https://code.aliyun.com/ecarx-web/node-apollo
- Declared license: ISC (per the upstream `package.json`)

**Scope of reuse:** the public API surface and code structure of this
package are derived from node-apollo: the functions
`remoteConfigServiceSkipCache`, `remoteConfigServiceFromCache`,
`remoteConfigService`, `remoteConfigServiceSikpCache` (spelling-compat
alias), `createEnvFile` and `setEnv` keep the same names, parameter
shapes and semantics; the URL-construction layout and the
`configurations || data` merge semantics of `lib/helper.js` are derived
from node-apollo as well (with documented fixes and hardening, see
README "Behavioral differences").

**License text completion note:** the upstream package ships **no
LICENSE file** (verified against the published 1.2.1 tarball). Its
`README.md` footer links to a `LICENSE` file that does not exist and
labels itself "[MIT](LICENSE)", which contradicts its own
`package.json` `"license": "ISC"` field. Per the PRD fact pack and the
approved plan, the `package.json` ISC declaration is treated as
authoritative, and the standard ISC template below is used to complete
the missing text. The year 2018 is taken from the upstream package's
last publish date; the copyright holder line is taken from the upstream
`package.json` `author` field.

ISC License

Copyright (c) 2018 Quinton.xu <Quinton.xu@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## 2. @lvgithub/ctrip-apollo-client@1.0.38 (MIT)

- Upstream package: `@lvgithub/ctrip-apollo-client` version 1.0.38
- Upstream repository: https://github.com/lvgithub/ctrip-apollo-client
- Declared license: MIT (per the upstream `package.json` and its
  `LICENSE` file)

**Scope of reuse:** two groups of this package's modules are derived
from the upstream implementation.

1. The signature module (`src/signature.ts`) derives from the upstream
   implementation of `genAuthHeaders` / `genSignature` /
   `url2PathWithQuery` (`src/index.js:395-436`):
   `crypto.createHmac('sha1')`, the `${timestamp}\n${pathWithQuery}`
   signing string, base64 output and `new URL` based path/query
   extraction. The function boundaries were reorganized to mirror the
   Apollo Java client `Signature` class (`signature` and
   `buildHttpHeaders` separated), and the result was validated against
   the Apollo Java client 2.4.0 protocol test vectors.
2. The mechanism modules for long polling (`src/watch.ts`),
   local caching (`src/cache.ts`), grayscale local-IP detection
   (`src/local-ip.ts`), meta service discovery (`src/discovery.ts`) and
   the change callback derive from the corresponding *mechanisms* of
   the upstream implementation (`src/index.js:76-247` long polling,
   `:249-295` local file cache, `:66-69` local IP attachment, `:99-114`
   meta discovery refresh): the polling state machine shape
   (`/notifications/v2` with per-namespace notificationId, 304
   continue, 200 refetch + callback), the persist-and-recover cache
   mechanism, the "attach a local IPv4 to config requests" mechanism
   and the "resolve and refresh a config service address through the
   meta server" mechanism. Each derived module documents its deviations
   in its source header; the deliberate non-copies (no-timeout
   requests, endless loop after failed init, the `global._apollo`
   global singleton, dotted-key expansion, per-round forced
   re-discovery, the off-by-one random pick) are listed there as well.

The following is the verbatim content of the upstream `LICENSE` file:

```
Copyright (c) 2020 liuwei <jolvmail@gmail.com>, contributors
https://github.com/lvgithub

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## 3. Protocol basis: Apollo Java client 2.4.0 (Apache-2.0)

The accesskey signing protocol implemented by this package follows the
Apollo Java client `apollo-core` / `apollo-client` version 2.4.0 as the
single authoritative reference (`Signature.java`,
`HmacSha1Utils.java`, `RemoteConfigRepository.java`). The Apollo Java
client is licensed under the Apache License, Version 2.0.

This npm package does **not** redistribute the Java client's code or
binaries. The corresponding jar / sources archives are archived in the
`reference/java/` directory of the source repository (excluded from the
npm package via the `files` whitelist) for maintenance reference, and
the complete Apache-2.0 license text covering that in-repository
redistribution is available at
[`reference/java/LICENSE.apache2.txt`](./reference/java/LICENSE.apache2.txt)
in the source repository.
