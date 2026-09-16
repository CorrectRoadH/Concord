---
format: concord.document/v1
id: load-compatible-repository-profile
title: 加载兼容的 Repository Profile
createdAt: 2026-09-13T11:00:38.089Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 加载兼容的 Repository Profile

## 场景

作为需要保留原仓库专属工作流的维护者，我希望 `concord repo` 只在 host 与当前 worktree 匹配、安装 engine identity 一致时加载 profile，从而避免用错误实现解释原有 Memory 与 formal evidence。

## 主流程

1. profile 配置声明 host module，host 明确提供 repository root、协议身份、`caseIdentity: "concord.case-contracts/v1"` 和产品专属 inventory/evidence 边界。
2. CLI 在执行 profile 命令前核对 host root 与当前 worktree，并核对已安装 engine identity。
3. 匹配时沿用 repository profile 的 Memory 生命周期与 formal proof 规则；不匹配时在任何业务操作前具名失败。

## 验收

- host 指向其它根目录时报 `RepositoryHostMismatch`。
- host 未声明当前注释身份协议时报 `RepositoryHostCaseIdentityUnsupported`，在业务操作前要求升级 host；不得回退标题 token。
- engine 内容与声明身份不一致时报 `RepositoryEngineMismatch`；缺少配置时报 `RepositoryProfileMissing`。
- 通用 Concord 的 command evidence 不能关闭要求 formal proof 的 profile Problem。
- 这些测试证明兼容与边界检查，不声称覆盖 NiceEval 的完整原生 inventory、E2E 或生产可靠性。

## 源码关系与正式证据

- 真实声明旁使用一个 `@feature` 或 `@use-case` canonical 路径注释；目标存在且类型匹配。多个测试可指向同一契约。
- 由 native 文件、声明文件与测试名称自动派生执行引用，无需人工 ID 或前置 attach。helper 用 `@test-file` 指定 native 文件；改名或移动后重新派生引用。
- host 必须在执行副本中将原生收集结果与源码声明唯一绑定。能力字段只是 host 的承诺，绑定算法须由消费仓库验证并纳入实现摘要。
- current 关系只存于源码；历史、退役与证据指针共用事务和完整 preimage 检查。
- 正式证据使用 `concord.repository-source-identity/v3`，绑定测试引用、文件路径和 direct-contract 路径及内容摘要。`concord.repository-source-projection/v2` 剥除关系注释，保留测试名称、逻辑及文件映射。
- 契约、源码、helper 或路径集合变化会使证据陈旧。旧 receipts 保留原件，新的 fixed 仍须通过完整正式 gate。
- 消费仓库使用锁定的已构建包，不依赖 Concord checkout；静态发现与 command evidence 不代表原生测试执行。
