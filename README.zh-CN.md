# apollo-config-client

[English](./README.md) | **简体中文**

Apollo（携程）配置中心 Node.js 客户端，支持 **accesskey 访问密钥签名**
—— [node-apollo](https://code.aliyun.com/ecarx-web/node-apollo) 的
drop-in 替代品，零运行时依赖。

当 Apollo 环境（服务端 ≥ 1.6.0）启用了访问密钥（accesskey）后，未带
签名的 `/configs` 请求会被 HTTP 401 拒绝。本包按官方 Java 客户端协议
（`apollo-core` / `apollo-client` 2.4.0）对每次配置请求签名，同时保留
`node-apollo` 的既有 API。

> 已在 Node 22（darwin arm64 / linux x64）实测；声明的引擎范围为
> `node >= 18`。

## 安装

```bash
npm install apollo-config-client
```

## 快速上手

### 从 node-apollo 无缝迁移（drop-in）

已经在用 `node-apollo` 的项目只需更换包名——函数名、参数结构完全一致：

```diff
- const apollo = require('node-apollo');
+ const apollo = require('apollo-config-client');

  const config = {
    configServerUrl: 'http://apollo.example.com',
    appId: 'sample-app',
    clusterName: 'default',
    namespaceName: ['application', 'fx.apollo'],
    // clientIp: '10.0.0.1',   // 可选
    // releaseKey: '',         // 可选
  };
  const result = await apollo.remoteConfigServiceSkipCache(config);
```

### 启用 accesskey 签名

只要密钥解析链（见下）能取到非空密钥，签名即自动生效。最快的方式是
显式传入：

```js
const { remoteConfigServiceSkipCache } = require('apollo-config-client');

const result = await remoteConfigServiceSkipCache({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: ['application'],
  secret: 'your-apollo-access-key-secret', // 增量字段
});
```

### 单命名空间 + 精确 304 语义

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
  // HTTP 304：配置未变化，沿用既有值即可。
} else {
  // config.configurations、config.releaseKey 等。
}
```

## 密钥配置（三类方式）

每次请求按以下优先级解析密钥，取到非空白值即停止，空白值穿透：

| 优先级 | 方式 | 说明 |
| --- | --- | --- |
| 1 | 显式传入 | config 对象的 `secret` 字段 |
| 2 | 环境变量 | `APOLLO_ACCESSKEY_SECRET`（**旧名，主**） |
| 3 | 环境变量 | `APOLLO_ACCESS_KEY_SECRET`（新官方名，兼容） |
| 4 | properties 文件 | 见下 |

> **两个环境变量同时设置时，以旧名 `APOLLO_ACCESSKEY_SECRET` 为准。**
> 这与 Apollo Java 客户端官方优先级（新名优先）相反，属本包面向用户
> 群体的既有约定。若担心歧义，建议只保留一个变量。

### properties 文件

路径：优先 `propertiesPath` 参数，默认
`<process.cwd()>/apollo-accesskey.properties`。文件缺失或不可读按空
处理，不会抛错。

键规则：带环境后缀的键优先于无后缀键；未提供 `env`（参数 `env` >
`process.env.APOLLO_ENV`）时只匹配无后缀键：

```properties
# apollo-accesskey.properties
apollo.accesskey.secret.dev=dev-secret-aaaaaaaaaaaaaaaa
apollo.accesskey.secret.prod=prod-secret-bbbbbbbbbbbbbbbb

# 无后缀回退键（无 env 时匹配；或对应环境无后缀键时回退匹配）
apollo.accesskey.secret=fallback-secret-cccccccccccccccc

# 同样支持新式键名作为回退
apollo.access-key.secret=fallback-secret-dddddddddddddddd
```

```js
await remoteConfigServiceSkipCache({
  configServerUrl: 'http://apollo.example.com',
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: 'application',
  env: 'dev',                       // 或依赖 APOLLO_ENV
  // propertiesPath: '/etc/apollo/accesskey.properties',
});
```

properties 解析支持范围：UTF-8（去除 BOM）、`#` / `!` 注释、`=` 或
`:` 分隔符、键值两端 trim。**不支持**续行与 unicode 转义。重复键以后
出现的值覆盖先前值。所有层都取不到密钥时，请求**不带**签名头直连
（未启用 accesskey 的环境不受影响）。

## 签名协议

与 Apollo Java 客户端 2.4.0（`Signature.java`、`HmacSha1Utils.java`）
逐字段对齐：

- 请求头：`Authorization: Apollo {appId}:{signature}` 与
  `Timestamp: {毫秒时间戳}`。
- `signature = Base64(HmacSHA1(secret, timestamp + "\n" + pathWithQuery))`，
  均按 UTF-8 编码；`pathWithQuery` 为 URL path 部分，存在非空 query
  时追加 `?` + 原始 query 串。
- 需签名接口：`/configs/{appId}/{cluster}/{namespace}` 与
  `/configfiles/json/{appId}/{cluster}/{namespace}`。

固定协议向量（已纳入测试套件）：

```text
secret        = test-secret-0123456789abcdef
timestamp     = 1700000000000
pathWithQuery = /configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1
signature     = dz4F7eaG+5I5PiWjETCC4+HcLjM=
```

也可直接使用签名工具：

```js
const { signature, buildHttpHeaders, url2PathWithQuery } = require('apollo-config-client');

signature('1700000000000',
  '/configs/sample-app/default/application?releaseKey=20261026150000-abc&ip=10.0.0.1',
  'test-secret-0123456789abcdef');
// => 'dz4F7eaG+5I5PiWjETCC4+HcLjM='
```

## 长轮询（watcher）：配置热更新

本包提供 `ApolloWatcher`，对带签名的 `/notifications/v2` 端点
做长轮询（同一套签名协议；机制取材自
[@lvgithub/ctrip-apollo-client](https://github.com/lvgithub/ctrip-apollo-client)
并与 Apollo Java 客户端对齐）：

```js
const { createApolloWatcher } = require('apollo-config-client');

const watcher = createApolloWatcher({
  configServerUrl: 'http://apollo.example.com', // 或 metaServerUrl，见下文
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: ['application', 'fx.apollo'],
  secret: 'your-apollo-access-key-secret',
  onChange: ({ config, changedNamespaces }) => {
    // `config` 是变更后【全量合并】的扁平配置对象。
    console.log('变更:', changedNamespaces, 'db.url =', config['db.url']);
  },
  onWarning: (err) => { /* 可恢复的失败（网络、HTTP、缓存 I/O） */ },
  onCacheLoaded: ({ config }) => { /* start 时从本地缓存恢复 */ },
});

await watcher.start();          // 首轮完成（或缓存恢复）后 resolve
watcher.getConfig();            // 全量合并配置；尚无数据时为 undefined
watcher.isRunning();            // 轮询循环存活时为 true
watcher.stop();                 // 全量资源回收；之后可再次 start
```

行为说明：

- 引导阶段使用 notificationId `-1`（Java 协议），首轮成功即经正常的
  200 → 回拉 → `onChange` 路径交付当前全量配置。
- **超时是强制的**（有意区别于上游的无超时实现）：长轮询读超时默认
  `90000` ms——刻意大于服务端约 60 秒的 hold 时长（`longPollTimeoutMs`）；
  回拉请求用 `timeoutMs`（默认 5000）；`start()` 引导受 `initTimeoutMs`
  （默认 10000）有界约束。引导超时会令 `start()` 以 `ApolloError`
  reject，但 watcher 仍在后台持续重试。
- 故障不会击穿轮询循环：每轮失败经 `onWarning` 上报，并按指数退避
  睡眠（`retryInitialMs` ×2 封顶 `retryMaxMs`，默认 1000 → 120000，
  任何成功轮次后重置回初始值）。
- `stop()` 立即中止在途的长轮询 / 回拉 / 服务发现请求、清除退避定时
  器并复位 notificationId——无悬挂 timer / socket，之后可重新 start。
- `onChange` 收到全量合并配置；回调抛异常不会中断轮询循环（异常经
  `onWarning` 上报）。
- 选项：`longPollTimeoutMs?`（90000）/ `initTimeoutMs?`（10000）/
  `retryInitialMs?`（1000）/ `retryMaxMs?`（120000）/
  `discoveryRefreshMs?`（60000）/ `cachePath?` / `onChange?` /
  `onWarning?` / `onCacheLoaded?`。

## 本地缓存

每次回拉成功后写入本地 JSON 缓存；进程重启后服务不可达时从缓存恢复
（机制取材自 @lvgithub，并做了加固）：

- 默认路径：
  `<cwd>/.apollo-config-client-cache/{appId}.{clusterName}.{isolation}.json`。
  其中 10 位 `isolation` 键为
  `sha256(唯一基址 + "\n" + JSON.stringify(排序后 namespaces)).slice(0,10)`，
  「唯一基址」是互斥校验后的唯一配置地址（`configServerUrl`，或启用
  发现时的 `metaServerUrl`）。同 appId+cluster 但不同服务端的实例
  不会共享缓存文件；共用同一 meta 的实例共享同一缓存域（动态实例
  地址不入键）。
- 文件名中的 `appId` 与 `clusterName` 组件会先做百分号编码（字面量
  点号编码为 `%2E`），防止路径穿越与组件分隔符冲突。watcher 只恢复
  缓存内 `appId` / `clusterName` 与当前配置一致的文件；不一致的缓存
  会忽略。显式 `version` 不是数字 `1` 时忽略该缓存；省略 `version`
  的文件仍按兼容格式接受。
- 写入为原子操作（同目录临时文件 + `rename`），中断不会留下半写文件。
- 缓存文件损坏或不可解析按「无缓存」容错，绝不抛致命错误。
- `cachePath: '<文件路径>'` 覆盖文件路径；`cachePath: false` 完全关闭
  缓存。
- 文件内容为各 namespace 的 `configurations`（保持扁平——**不做**
  点号 key 展开为嵌套对象）与 `releaseKey`。

## 灰度 IP

`/configs`、`/configfiles/json` 与 `/notifications/v2` 均携带 `ip=`
查询参数用于灰度发布：

1. 显式 `clientIp` 参数始终优先。
2. 未显式传入时，通过 Node 内建 `node:os` 模块自动探测本机 IPv4
   （零运行时依赖——有意不引入 `internal-ip`）。每次请求都重新探测，
   不做模块级缓存。
3. `autoDetectIp: false` 不携带 `ip` 参数，与 node-apollo 底座行为
   一致（适合需要 URL 逐字节稳定的场景）。

## meta 服务发现

可以不固定 `configServerUrl`，改为配置 `metaServerUrl`：此时通过
**免签名**的 `GET {metaServerUrl}/services/config?appId=&ip?` 解析
配置服务地址（Java `ConfigServiceLocator` 对该接口同样不加签名），
随机选取一个实例的 `homepageUrl`：

```js
const { createApolloWatcher, remoteConfigServiceSkipCache } = require('apollo-config-client');

const watcher = createApolloWatcher({
  metaServerUrl: 'http://apollo-meta.example.com', // 取代 configServerUrl
  appId: 'sample-app',
  clusterName: 'default',
  namespaceName: 'application',
  secret: 'your-apollo-access-key-secret',
  onChange: ({ config }) => { /* ... */ },
});
```

- 解析结果按 TTL 记忆（`discoveryRefreshMs`，默认 60000）——服务列表
  变化会被感知，不会只在初始化解析一次后永不刷新。
- 刷新失败（列表为空、网络错误）沿用旧地址并经 `onWarning` 上报；仅
  当不存在旧地址时才抛错。所选地址发生网络级失败会使记忆失效，下轮
  强制重新发现。
- **互斥校验**：`configServerUrl` 与 `metaServerUrl` 互斥——同时配置
  会抛
  `ApolloError("configServerUrl and metaServerUrl are mutually
  exclusive, configure exactly one")`。该校验适用于
  `remoteConfigServiceSkipCache`、`remoteConfigServiceFromCache`、
  `queryConfig` 与 watcher。**豁免**：OpenApi 入口
  `remoteConfigService`（token 形态继承面）不消费 `metaServerUrl`、
  不参与互斥校验。
- 未配置 `metaServerUrl` 时直接使用显式 `configServerUrl`（与
  node-apollo 底座一致，保持不变）。

## 多实例

实例之间完全独立——不存在全局单例状态（有意不复制上游的
`global._apollo`）。同一进程可以运行多个 watcher（不同 appId、
cluster、服务端或 meta），各自持有独立的 notificationId、缓存文件
（隔离键命名）、AbortController 与回调：

```js
const w1 = createApolloWatcher({ appId: 'app-one', configServerUrl: 'http://s1', /* ... */ });
const w2 = createApolloWatcher({ appId: 'app-two', configServerUrl: 'http://s2', /* ... */ });
await w1.start();
await w2.start();
```

## 304 语义

- `queryConfig` 收到 HTTP 304 时 resolve `{ notModified: true }`。
- `remoteConfigServiceSkipCache` / `remoteConfigServiceFromCache` 在
  **全部**命名空间都返回 304 时 resolve `null`，语义为「保持既有配
  置」。混合 304/200 时仅合并 200 部分。304 永远不会按错误处理。

## 401 排查

收到 `HTTP 401` 时抛出 `ApolloUnauthorizedError`（不自动重试），错误
消息会指向三类密钥配置方式。排查清单：

1. 该 Apollo 环境是否确实启用了访问密钥？
2. 密钥是否经三类方式之一正确提供（显式传入 / 环境变量 / properties
   文件）？无副作用的检查方式：
   `require('apollo-config-client').resolveAccessKeySecret()` 返回解析到的
   密钥或 `undefined`——与 Apollo 控制台中的值比对。
3. 客户端时钟是否经 NTP 校时？签名携带毫秒时间戳，时钟偏差可能导致
   服务端拒绝正确密钥。

## 错误类型

| 错误类 | 含义 | 附加字段 |
| --- | --- | --- |
| `ApolloError` | 基类（参数缺失等也使用） | `url?` |
| `ApolloUnauthorizedError` | HTTP 401，密钥缺失或错误 | `statusCode`、`appId`、`url` |
| `ApolloHttpError` | 其他非 2xx/非 304 状态；非法 JSON；404 附带「namespace 可能未发布」提示 | `statusCode`、`url` |
| `ApolloNetworkError` | 连接失败或超时 | `url` |

错误消息与字段一律不包含密钥（secret）。

## API

```ts
// drop-in 兼容基线（与 node-apollo 一致）
remoteConfigServiceSkipCache(config): Promise<Record<string, string> | null>
remoteConfigServiceFromCache(config): Promise<Record<string, string> | null>
remoteConfigService(config): Promise<Record<string, unknown>>      // OpenApi token 透传
remoteConfigServiceSikpCache(config)                               // 拼写别名（deprecated）
createEnvFile(envConfig: object, filePath?: string): void          // 默认 ./default.env
setEnv(filePath?: string): void                                    // 注入，不覆盖已有变量

// accesskey 增量 API
queryConfig(config & { namespaceName: string }): Promise<{ notModified: true } | ApolloConfig>
signature(timestamp: string, pathWithQuery: string, secret: string): string
buildHttpHeaders(url: string, appId: string, secret: string): { Authorization: string; Timestamp: string }
url2PathWithQuery(url: string): string
resolveAccessKeySecret(input?: { secret?: string; env?: string; propertiesPath?: string }): string | undefined

// 机制增量 API
createApolloWatcher(options): ApolloWatcher                        // = new ApolloWatcher(options)
watcher.start(): Promise<void>                                     // 幂等；initTimeoutMs 有界
watcher.stop(): void                                               // 全量资源回收，可重启
watcher.getConfig(): Record<string, string> | undefined
watcher.isRunning(): boolean
detectLocalIpv4(): string | undefined                              // node:os，无模块级缓存
invalidateDiscoveryCache(): void                                   // 丢弃 meta 发现 TTL 记忆
defaultCachePath(input): string                                    // 隔离键命名的默认缓存文件路径
```

`config` 字段：`configServerUrl`（或 `metaServerUrl`；二者恰好其一
——OpenApi 入口 `remoteConfigService` 豁免）、`appId`、`clusterName`、
`namespaceName`（字符串或数组；空数组回退 `application`）、
`releaseKey?`、`clientIp?`（显式灰度 IP）、`autoDetectIp?`（默认
`true`；`false` 表示不携带探测到的 IP）、`discoveryRefreshMs?`
（默认 60000），以及增量字段 `secret?`、`propertiesPath?`、`env?`、
`dataCenter?`、`timeoutMs?`（默认 5000）。

## 与 node-apollo@1.2.1 的行为差异

以下均为 drop-in 路径上的有意改进：

1. `releaseKey` / `clientIp` / `dataCenter` 未传（或为空）时不再产生
   `?releaseKey=undefined&ip=undefined` 碎片。
2. `configServerUrl` 尾斜杠归一化；path 段（`appId` /
   `clusterName` / `namespaceName`）增加 `encodeURIComponent` 转义
   （底座无转义）。常规 ASCII 取值下 URL 与底座完全一致。
3. HTTP 304 不再按错误处理；见上文 304 契约。
4. 401 / 404 / 网络错误抛结构化错误类，而非裸 assert；
   `remoteConfigService` 错误消息保留底座措辞。
5. `createEnvFile` / `setEnv` 落盘位置由包自身目录改为
   `process.cwd()/default.env`（底座写安装目录，实际只读不可用）；
   另提供可选 `filePath` 参数。
6. `setEnv` 改用内置极简 `.env` 解析（`KEY=VALUE`、`#` 注释、trim、
   **不覆盖已有环境变量**），替代 dotenv@4；不支持引号剥离与变量展
   开；重复键以后出现的值覆盖先前值。文件缺失或不可读时静默不注入。
7. 空数组 `namespaceName` 仍回退 `application`；保留拼写别名
   `remoteConfigServiceSikpCache`（已标 deprecated）。
8. TLS 证书校验保持 Node 默认开启（底座经 urllib 的
   `rejectUnauthorized: false` 关闭）。自建 CA 的内网服务端请通过
   `NODE_EXTRA_CA_CERTS` 注入证书。
9. 每个请求带超时（默认 5000ms，`timeoutMs` 可调），不再无限等待；
   零运行时依赖（移除 urllib@2 与 dotenv@4）。
10. 未显式配置 `clientIp` 时，自动探测的本机 IPv4（`node:os`）会作为
    `ip` 查询参数附加到每个请求（灰度支持）。`autoDetectIp: false`
    可恢复与 node-apollo 底座完全一致的 URL。显式 `clientIp` 的行为
    与底座一致。

## 从 @lvgithub/ctrip-apollo-client 迁移

能力对照（机制级对等，API 名称不同）：

| 上游 | 本包 |
| --- | --- |
| `new CtripApolloClient(option)` + `ready()` | `createApolloWatcher(options)` + `await watcher.start()` |
| `stop()` | `watcher.stop()`（并中止在途请求、可重启） |
| `getConfigs()` | `watcher.getConfig()` |
| `onChange(cb)` | `onChange` 选项（`{ config, changedNamespaces, source }`） |
| `getValue` / `hotValue` / `withValue` / 装饰器 | 有意不提供（属实现风格而非能力）；直接读 `watcher.getConfig()` |
| `configPath` | `cachePath`（字符串文件路径，或 `false` 关闭；默认隔离键命名） |
| `initTimeoutMs` | `initTimeoutMs`（默认 10000） |
| meta 服务发现 | `metaServerUrl`（含 TTL 刷新与失败容错，见上文） |
| `accessKey` | `secret`（另有完整的三类密钥解析链） |
| `global._apollo` 全局单例 | 不复制：实例相互独立 |

## Roadmap

- 按 appId 覆盖密钥（`apollo.accesskey.{appId}.secret`，Java 语义）
  ——首版未纳入。

## 致谢与来源

本包是对现有开源项目的增量扩展（衍生作品），感谢原作者：

- 基于
  [node-apollo@1.2.1](https://code.aliyun.com/ecarx-web/node-apollo)
  （ISC 许可，作者 Quinton.xu，Quinton.xu@gmail.com）增量扩展并保持
  API 兼容——复用范围：公开 API 面与代码结构（函数名、参数结构、
  URL 构造布局与合并语义）。
- 签名、长轮询、本地缓存、灰度 IP 探测、meta 服务发现与变更回调取材
  [@lvgithub/ctrip-apollo-client@1.0.38](https://github.com/lvgithub/ctrip-apollo-client)
  （MIT 许可）——复用范围：签名模块实现手法（`createHmac('sha1')`、
  `\n` 拼接签名字符串、base64、`new URL` 解析 path/query），以及
  上述五项机制的实现机理（各衍生源文件头部注明差异；有意不
  复制项包括无超时请求、`global._apollo` 全局单例与点号 key 展开等）。
- 协议依据：Apollo Java 客户端（`apollo-core` / `apollo-client`
  2.4.0，Apache-2.0）。

两份上游许可的完整文本与版权声明保留在
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)；衍生源码文件头部
亦有出处注释。

## 许可

[MIT](./LICENSE)。上游声明：[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
