# AGENTS.md

本文件用于约束 AI Agent 在当前项目中的开发、审查、测试和提交行为。

<!-- AI-CODEBASE-INDEX-RULES:START -->

## AI Codebase Index Rules（强制）

这些规则由 `ai-codebase-index` Skill 管理，用于约束所有开发、审查、测试和提交类 Agent。

### 必须先查索引

- Agent 在实现功能、修复 bug、重构、审查代码、补测试、生成提交说明之前，必须先读取 `.ai-index/INDEX.md`。
- 不允许在未查看索引的情况下直接全仓库盲扫、盲目 grep、重复阅读大量源码。
- 查找已有能力时，必须优先查看：
  - `.ai-index/reusable-map.md`
  - `.ai-index/module-map.md`
  - `.ai-index/file-map.md`
  - `.ai-index/api-map.md`
  - `.ai-index/data-map.md`
  - `.ai-index/test-map.md`

### 修改前的影响范围检查

- 新增功能前：先读 `module-map.md` 和 `reusable-map.md`，确认是否已有可复用模块、工具、组件、服务或业务能力。
- 修改 API / Controller / Route / RPC / GraphQL / 消息入口前：先读 `api-map.md` 和 `change-impact.md`。
- 修改数据模型 / Entity / Schema / Migration / Repository / DAO 前：先读 `data-map.md` 和 `change-impact.md`。
- 修改配置、构建、依赖、脚本前：先读 `config-map.md`、`script-map.md` 和 `change-impact.md`。
- 修改公共方法、公共类、共享组件、基础服务前：先读 `reusable-map.md` 和 `dependency-map.md`。

### 生成物处理规则

- `.ai-index/**` 是 AI 索引生成物，可以随提交更新，但不得作为业务变更来源。
- `.ai-index/**` 不得写入 `change_logs` 的功能要点、详细变动或涉及代码。
- `change_logs/**`、`site_map.md`、`sitemap.md`、`sitemap.xml` 属于提交/站点地图辅助生成物，永远不得进入 `.ai-index`。
- 生成 Commit Message、变更日志、功能地图时，必须排除 `.ai-index/**`、`change_logs/**`、`site_map.md`、`sitemap.md`、`sitemap.xml`。
- 本 `AGENTS.md` 中位于 `AI-CODEBASE-INDEX-RULES` 标记之间的内容由索引 Skill 管理；更新时只能整体替换该区块，不要重复追加。

### 推荐工作流

1. 读取 `.ai-index/INDEX.md`。
2. 根据任务类型读取对应 map 文件。
3. 再按索引定位到少量真实源码文件。
4. 修改代码。
5. 运行或补充必要测试。

<!-- AI-CODEBASE-INDEX-RULES:END -->
