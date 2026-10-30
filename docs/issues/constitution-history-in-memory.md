---
status: open
---

# 宪法修订历史仍写在 frontmatter

## 现象

[演进宪法](../feature/project-onboarding/use-case/evolve-constitution.md)已改为：宪法 frontmatter 只有 `format: concord.constitution/v3` 与 `status`，adopt 与 amend 在同一次发布中写入 Decision Memory。实现仍是 v2：`amendedAt`、`ratifiedAt` 与 `amendments` 写在宪法 frontmatter 中，本仓库的 `docs/constitution.md` 也仍是 v2。

## 差距

- 宪法 Schema v3；adopt 与 amend 生成 current 的 Decision Memory 并 promote 到受影响的款，与正文同一发布。
- Memory promotion 接受宪法条款与款作为目标。
- `constitution migrate` 把 v2 的采用与修订记录转为 Decision Memory，迁移本仓库宪法。
- init 模板、Web 宪法编辑 action 与相关测试。
