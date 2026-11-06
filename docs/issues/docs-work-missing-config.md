---
relations:
  - role: adopts
    target: docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
---

# 没有项目配置时 docs work prepare 失败

## 现象

仓库没有 `concord.config.ts` 时，`concord docs work prepare` 返回 `DocsWorkPlanInvalid: Cannot read project configuration`（problem code `UnsafePath`）；`src/app/docs-work.ts:27` 直接读取配置文件。由 docs-refactor-governance 实测，加上 `export default {};` 后才能继续。

## 期望

配置可以不存在，`docsWork` 可选；没有配置时按默认值规划（[并行切分文档工作](../feature/neutral-project-governance/use-case/coordinate-docs-work.md)）。
