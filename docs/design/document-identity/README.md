---
format: concord.document/v1
id: document-identity
title: 文档身份与物理名称分离
createdAt: 2026-09-24T00:00:00.000Z
kind: design
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-010
  - docs/constitution.md#c-012
alternatives:
  - shared-policy
  - per-entry-validation
decision:
  selected: shared-policy
  reason: 各入口共享布局和身份解析，避免中文名称、归档分类与写入定位出现分歧。
  at: 2026-09-24T00:00:00.000Z
  targets:
    - docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
---

# 文档身份与物理名称分离

采用共享政策：内部 ID 用于查询，实际路径拥有 canonical 身份，创建命名是默认值。名称语法、分类根、package/leaf 布局、现行与历史分类由同一模块定义；各入口保留自己的错误协议与资源生命周期。

普通 package 保持单层目录，Research 保留嵌套例外；Memory 的路径身份与短 ID 歧义拒绝保持不变。历史材料限于 Memory-only 来源内其他 kind 的有效 owner，不引入 docs owner 原地归档，也不更改 metadata。

与逐入口修补相比，共享政策同时约束普通 CLI、高级治理、Web 导航和页面编辑。逐入口方案无法防止创建成功而校验、编辑或恢复失败，因此不采用。

写入解析冻结实际路径、类型、ID 与完整前像；租约内重新核对映射，漂移拒绝。恢复只使用日志中的实际路径。高级治理保留既有静态搜索与授权范围，不借命名支持引入跨来源写入或修改持久 journal；普通入口继续使用既有配置绑定日志。归档显示只读，当前断链仍诊断。来源移动不会重签或接续旧证据。

验收覆盖独立中文名称、重复创建和采用、归档边界、定位漂移、路径恢复、Web 实际 owner 跳转以及打包消费者。
