---
format: concord.document/v1
id: manage-scoped-terminology
title: 管理按目录归属的术语与写作写作规则
createdAt: 2026-09-23T02:49:08.732Z
kind: use-case
feature: docs/feature/documentation-quality/README.md
---



# 管理按目录归属的术语与写作写作规则

领域术语由 concepts.md 拥有：每个概念有稳定局部 ID、唯一写法、定义段落与解释，旧写法列为弃用名称。全局与 Feature、Engineering 及其子目录可以分别声明；文件所在目录决定局部作用域。全项目视图自动汇总来源，不创建第二份登记表或把局部定义改成全局。

Concord CLI 与 Web 提供发现、读取、显式创建、摘要保护的修改和条目删除；导入与正文链接都指向原定义。弃用名称只在有效作用域派生检查，建议改为该概念的写法。局部写作规则不能扩大路径范围，不能静默覆盖全局定义；同名不同义在不同范围可并存，汇总保留出处。

规则发现、解析、有效作用域与检查共用实现；结构不合规、路径不安全、悬空引用、断开的正文链接及同作用域冲突不被静默忽略。写入和中断恢复遵守同一授权。定义与解释写在同一 concepts.md，其它 Markdown 链接到定义；v1 JSON 与旧写作规则须显式迁移，不能后台推断写法、定义或重写历史。

验收涵盖全局/Feature/Engineering/嵌套目录、兄弟隔离、导入及删除保护、正文链接校验、结构错误、冲突、CAS 与原文字节保存、dry-run、伪造 journal 与恢复、v1 迁移事务、打包 CLI 和真实 Web 的源码编辑/脏草稿保护。

作用域合成见 docs/design/scoped-terminology/README.md，来源格式与迁移见 docs/design/markdown-terminology/README.md。

Web 默认以左侧术语列表和右侧定义呈现全项目术语，支持按写法、定义及目录筛选，保留来源范围。选中术语后在右侧打开所属 concepts.md 源码并定位到该概念，实时显示结构诊断，保留显式保存；目录选择常驻左侧，省去重复的设置标题与下拉框；跨目录引用在编辑区维护。独立的「写作」入口承载规则配置和已保存文档检查。切换视图保留未保存草稿，切换范围及离开页面继续遵守草稿保护。

界面用词见[在 Web 管理写作规则与术语](manage-writing.md)。
