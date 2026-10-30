---
format: concord.document/v1
id: configure-memory-sources
title: 配置和使用多个 Memory 来源
kind: use-case
feature: docs/feature/project-onboarding/README.md
---


# 配置和使用多个 Memory 来源

## 用户目标

维护者在初始化时配置 Memory 后端与具体来源，明确读取范围与写入目标，未来能接入更多 provider。

## 完整路径

1. 默认提供项目本地文件来源 `{name: "project", provider: "local-files", path: "memory", access: "read-write", defaultWrite: true}`；provider 只有本地文件时不展示虚假多选。
2. 交互添加来源，或用 `concord init --memory-sources <json>` 提交 `memorySources` 数组，每项给出 `name`、`provider`、`path`、`access` 与可选 `defaultWrite`。
3. 查询聚合全部来源，结果能辨认来源；`memory add` 写入默认来源，`--source <name>` 选择其它可写来源。
4. 遇到重复身份、不可用来源、只读写入或非法路径时得到具名错误。

## 规则

- 来源是当前 worktree 内互不重叠的安全目录，不与 docs 根、源码根、测试根或 Git-private 范围重叠。
- canonical path 拥有 Memory 身份；同一来源内 ID 唯一。不同来源可以有相同 ID，按短 ID 选择时歧义返回 `AmbiguousDocument`，改用 canonical path。改名不改变身份；改目录即改变 canonical path。
- 恰好一个可写来源是默认写入目标。聚合读取不隐含多处同步写入。
- 只读检查覆盖 author、metadata、Markdown 与 adoption 等间接写入；adoption 需要修改只读 Memory 时整批零写入。
- 配置的来源缺失不视为空。`memory resolve --kind fixed` 用解析后的 canonical Problem 路径比对回归关系，只使用当前消费者签发的证据；外部来源不借用当前项目证据关闭 Problem。额外来源中的非 owner 文件仍计入实现候选摘要。

| 错误 | 触发条件 |
| --- | --- |
| `InvalidMemorySources` | 名称或路径重复、默认可写来源不是恰好一个、路径不安全或与其它根重叠 |
| `MemorySourceUnavailable` | 配置的来源目录不存在；init 时只读来源必须已存在 |
| `MemorySourceNotFound` | `--source` 不匹配任何来源 |
| `ReadOnlyMemorySource` | 直接或间接写入只读来源 |

不存在的 provider 由 Schema 严格拒绝。

## 可观察验收

配置驱动真实读取与写入：两个来源含相同短 ID 时都可按路径读取，短 ID 歧义拒绝；fixed 绑定精确路径；只读 Memory 导致相关 adoption 整批零写入。

## Spec 来源

[目标与范围](../README.md)。来源限于本地文件，以保留 canonical 引用与证据边界（[决策依据](../../../design/onboarding-contracts/DECISION.md)）。
