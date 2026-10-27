---
name: release
description: apollo-config-client 公网 npm 发版助手。执行发布前检查（构建、全量测试、pack 白名单、README/版本断言）、验证公网 npm 源与登录态、npm publish --dry-run 预演。任何真实发版（npm publish）必须先获得用户明确确认。用户要求“发版 / 发布 / publish / 预演发版 / 发 npm”时使用。
---

# apollo-config-client 发布流程

## 硬性约束

1. **真实 `npm publish` 必须先获得用户明确确认**；未确认时只执行到
   dry-run 为止。
2. **发布目标是公网 `https://registry.npmjs.org`**。本机 `~/.npmrc`
   默认源是内网镜像（`npm config get registry` 查看，凡非
   registry.npmjs.org 均视为内网源），因此所有发布/查看命令都必须
   显式携带 `--registry https://registry.npmjs.org`，否则会把包发到
   内网源。
3. **包内容白名单固定 29 个文件**（`test/package.test.js` 断言）：
   `LICENSE`、两份 README、`THIRD-PARTY-NOTICES.md`、`package.json`
   与 `dist/` 下 12 组 `.js`+`.d.ts`。发布物中禁止出现
   `src/`、`test/`、`reference/`、`docs/`、内网域名和任何真实
   密钥（测试会扫描）。
4. `.ai-index/**`、`change_logs/**`、站点地图文件永远不属于发布物，
   也不得写进功能变更说明。

## 环境准备

```bash
# Node >= 22（本项目用 nvm）
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"

# 1) 登录态：公网 npm 必须已登录（ENEEDAUTH 则提示用户先执行 login）
npm whoami --registry https://registry.npmjs.org

# 2) 包名核验：404 = 名字可用；一旦有人抢注需停下向用户汇报
npm view apollo-config-client --registry https://registry.npmjs.org
```

## 发布前检查（按顺序全部通过）

```bash
# ① 构建：dist/ 已被 .gitignore，main 指向 dist/index.js —— 必须构建
npm run build

# ② 全量测试：190 项，包含 pack 白名单 / 密钥泄漏扫描 / README 归属
#    断言 / 版本号断言 / 零运行时依赖审计
npm test

# ③ 发布预演：核对 29 个文件清单、总大小，无 src/test 泄漏
npm publish --dry-run --registry https://registry.npmjs.org
```

说明：`package.json` 的 `prepublishOnly` 在真正 publish 时会自动再跑
一遍 `npm run build && npm test`，属于双保险；上面三步是人工关口，
必须先全部通过。

## 版本策略（semver，随功能自动升级）

| 版本 | 内容 |
| --- | --- |
| 1.0.0（首个公网版本） | node-apollo drop-in 兼容 + accesskey 签名 + 长轮询 watcher、本地缓存、灰度 IP、meta 服务发现、多实例独立 |
| 1.1.0 | ⚠️ 该版本号已作废（曾误发后撤回，npm 永久禁止复用任何已 unpublish 的版本号）；下个功能版本请用 1.1.1 或 1.2.0 |

后续升级规则：

- 缺陷修复 / 行为微调 → **patch**；
- 新增向后兼容功能（新 API、新选项）→ **minor**；
- 破坏公开 API / 默认行为不兼容变更 → **major**。

**升版本必须同步三处**：`package.json` 的 `version`、
`test/package.test.js` 中的 `assert.strictEqual(pkg.version, '...')`，
以及两份 README 里 "Since v1.x" / “自 v1.x 起” 的新特性表述。

## 发版步骤（仅在用户确认后执行）

```bash
# ① 停下来：向用户展示 dry-run 结果与版本号，获得明确确认
# ② 真实发布
npm publish --registry https://registry.npmjs.org
# ③ 发布后验证
npm view apollo-config-client@<version> --registry https://registry.npmjs.org
```

## GitHub 同步（发布后必做）

```bash
# ① 提交并推送（dist/ 已忽略，源码与文档入库）
git add -A && git commit -m "release: v<version>" && git push origin main
# ② 打 tag 并推送
git tag v<version> && git push origin v<version>
# ③ GitHub Release（gh 已登录；标题 = tag，正文列本版要点）
gh release create v<version> --title "v<version>" --notes "<本版变更要点>"
```

首次同步（仓库尚不存在时）：

```bash
# gh 需要先授权：gh auth login -h github.com -p ssh --skip-ssh-key --web
gh repo create liuleiyu121520/apollo-config-client --public
git remote add origin git@github.com:liuleiyu121520/apollo-config-client.git
git push -u origin main && git tag v<version> && git push origin v<version>
```

推送公开仓库前的泄漏检查（必须零命中）：

```bash
git grep --cached -l 'fang\.com'        # 内网域名（test/package.test.js
                                         # 的金丝雀字符串除外）
git grep --cached -l '<accesskey>'      # 任何真实密钥
# .gitignore 必须已排除：.e2e-evidence/（含密钥截图）、
# docs/software-company/（内部评审记录）、dist/、node_modules/
```

## 常见问题

- **`npm publish` 卡在登录**：本机 npm 默认 token 属于内网源，公网
  发布需要 `npm login --registry https://registry.npmjs.org` 交互登录。
- **2FA 只绑了安全密钥（Passkey）、没有 6 位 TOTP 码**：非交互终端
  会报 `EOTP`。用伪终端跑发布，npm 会生成浏览器授权链接，点开用
  安全密钥确认即可自动完成：
  `printf '\n' | script -q /dev/null npm publish --registry https://registry.npmjs.org`
  （macOS；从输出里把 `https://www.npmjs.com/auth/cli/...` 链接取给
  用户点击。）
- **发布后 `npm view` 显示 `0.0.0-stage` 占位版本**：npm 对新包首次
  发布有暂存审核机制（"Your package is being processed"），几分钟内
  会被真实版本替代，轮询 `npm view apollo-config-client version` 直到
  变为目标版本即可。
- **误发版本要撤回**：72 小时内且无人依赖时可
  `npm unpublish apollo-config-client@<version> --registry https://registry.npmjs.org`
  （同样走 2FA）。注意：**被 unpublish 的版本号永久作废**，之后任何
  内容都不得再使用该号。
- **pack 文件数不对**：先 `rm -rf dist && npm run build` 重建，再查
  `test/package.test.js` 的 `EXPECTED_PACK_FILES` 是否与新增模块同步。
- **README 断言失败**：两份 README 必须同时包含归属三要素
  （node-apollo/ISC、@lvgithub/ctrip-apollo-client/MIT、Java 客户端
  2.4.0）与 v1.0 五大机制章节（长轮询/本地缓存/灰度 IP/meta 服务
  发现/多实例）。
