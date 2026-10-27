<!-- AI Index Generated File: do not edit manually. Regenerate with scripts/update_ai_index.js. -->

# Conventions

## Agent 通用规则

- 修改代码前，先读 `.ai-index/INDEX.md`。
- 新增功能前，先读 `module-map.md` 与 `reusable-map.md`。
- 修改接口、模型、配置、公共方法前，先读 `change-impact.md`。
- 不要把 `.ai-index/**`、`change_logs/**`、`site_map.md` 当作业务变更来源来生成提交说明。
- `.ai-index/**` 是生成物，可以随提交更新，但不得写入 changelog 的“功能要点 / 详细变动 / 涉及代码”。
- 若仓库存在 `AGENTS.md`、`CLAUDE.md`、`README.md` 或更具体的项目规范，优先遵守更具体规则。
- 若索引与当前暂存区不一致，先运行索引更新脚本。

## Detected Stacks

- node/javascript-typescript
