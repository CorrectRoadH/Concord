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

1. profile 配置声明 host module，host 明确提供 repository root、协议身份和产品专属 inventory/evidence 边界。
2. CLI 在执行 profile 命令前核对 host root 与当前 worktree，并核对已安装 engine identity。
3. 匹配时沿用 repository profile 的 Memory 生命周期与 formal proof 规则；不匹配时在任何业务操作前具名失败。

## 验收

- host 指向其它根目录时报 `RepositoryHostMismatch`。
- engine 内容与声明身份不一致时报 `RepositoryEngineMismatch`；缺少配置时报 `RepositoryProfileMissing`。
- 通用 Concord 的 command evidence 不能关闭要求 formal proof 的 profile Problem。
- 这些测试证明兼容与边界检查，不声称覆盖 NiceEval 的完整原生 inventory、E2E 或生产可靠性。

## 源码关系与正式证据

- profile 的 current 关系由真实声明旁 `@concord-case`、`@concord-owner` 及 regression/issue 注释拥有；title 保留永久 ID，helper 用 `@concord-test-file` 绑定 native path。原生 collection 是可执行 inventory 的唯一见证。
- history/tombstone 只追加到注释归档；移动与退役保留 ID，当前关系不另存 JSON registry。关系、源码、归档与证据指针共用事务和完整 preimage 检查。
- 新 v2 formal evidence 绑定固定执行副本的版本化源码投影、case/native path 与完整 owner/contract 内容。合法关系登记不会让刚生成的 proof 自失效；代码、helper、路径集合和契约变化必须使其陈旧。
- 旧 v1 证据和 fixed Memory 保留历史可读并显示 legacy/stale/unavailable，新 fixed 拒绝使用 v1。已有 current regression 用显式 refresh、非空 reason、open Problem 和新受管 proof 更新，原子保留旧指针，不重复添加关系。
- 消费仓库使用锁定的已构建包，不依赖 Concord checkout；`concord --skill repository` 在任意 cwd 提供按需指引。
