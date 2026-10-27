# reference/

Apollo Java 客户端 2.4.0 的协议权威参照归档（jar 与 sources），仅用于
`apollo-accesskey` 包的 accesskey 签名协议实现、验收与后续维护时对照，
**不参与构建、不出现在 npm 发布产物中**（`package.json` 的 `files`
白名单已将其排除）。

## 出处

- 组件：`com.ctrip.framework.apollo:apollo-core` / `com.ctrip.framework.apollo:apollo-client`
- 版本：2.4.0
- 来源：Maven Central（https://repo1.maven.org/maven2/com/ctrip/framework/apollo/）
- 目录内容：
  - `apollo-core-2.4.0.jar` / `apollo-core-2.4.0-sources.jar`
  - `apollo-client-2.4.0.jar` / `apollo-client-2.4.0-sources.jar`
  - `apollo-core-sources/` / `apollo-client-sources/`（解包后的源码树）
  - `LICENSE.apache2.txt`（Apache-2.0 完整许可文本）

## 关键协议文件

- `apollo-core-sources/com/ctrip/framework/apollo/core/signature/Signature.java`
- `apollo-core-sources/com/ctrip/framework/apollo/core/signature/HmacSha1Utils.java`
- `apollo-core-sources/com/ctrip/framework/apollo/core/ApolloClientSystemConsts.java`
- `apollo-client-sources/com/ctrip/framework/apollo/internals/RemoteConfigRepository.java`

## 再分发说明

Apollo Java 客户端 2.4.0 以 Apache-2.0 许可发布。依据 Apache-2.0 第 4 条，
本仓库侧再分发上述 jar 与 sources 时保留完整许可文本与版权声明，
见 [java/LICENSE.apache2.txt](./java/LICENSE.apache2.txt)。
各源码文件头部亦保留上游自带的 Apache-2.0 声明。
npm 发布物不包含本目录，无 Java 源码再分发。
