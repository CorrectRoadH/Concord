---
format: concord.document/v1
id: manage-scoped-terminology
title: 管理按目录归属的术语与写作政策
createdAt: 2026-09-23T02:49:08.732Z
kind: use-case
feature: docs/feature/documentation-quality/README.md
---

# 管理按目录归属的术语与写作政策

领域术语由 JSON 拥有定义、稳定局部 ID、多语言首选名称、允许别名与弃用名称。全局与 Feature、Engineering 及其子目录可以分别声明；文件所在目录决定局部作用域。全项目视图自动汇总来源，不创建第二份登记表或把局部定义改成全局。

Concord CLI 与 Web 提供发现、读取、显式创建、摘要保护的修改和条目删除；引用指向原定义。正常别名不派生禁词，弃用名称只在有效作用域派生检查。局部政策不能扩大路径范围，不能静默覆盖全局定义；同名不同义在不同范围可并存，汇总保留出处。

规则发现、解析、有效作用域与检查共用实现；JSON 损坏、路径不安全、悬空引用及同作用域冲突不被静默忽略。写入和中断恢复遵守同一授权。Markdown 保留解释与案例，结构化定义只由 JSON 维护；旧政策须显式迁移，不能后台推断定义或重写历史。

验收涵盖全局/Feature/Engineering/嵌套目录、兄弟隔离、引用及删除保护、冲突、CAS、dry-run、伪造 journal 与恢复、旧格式诊断、打包 CLI 和真实 Web 的编辑/脏草稿保护，以及指定 NiceEval worktree 的无残留验收。

具体作用域合成与持久化采用方案见 docs/design/scoped-terminology/README.md。
