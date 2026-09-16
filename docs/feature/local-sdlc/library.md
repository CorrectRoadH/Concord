# 领域与数据所有权

## Owner

Feature 与 Use Case 拥有当前产品契约；Engineering 拥有仓库维护机制；Research 保存带时间的决策输入；Design 保存候选与唯一裁决；Roadmap 保存方向和采用历史；Memory 保存 Problem、Decision、Insight 及其生命周期。测试源码拥有 case 身份和正向关系，Git 保存它们的演进。

## 派生关系

`@feature` 或 `@use-case` 用 canonical 路径指向对应契约，`@regression` 可重复指向 Problem。执行引用由文件路径与测试名称自动派生。契约不反写测试列表，trace 每次从 owner 和源码重新编译反向关系。

## 私有状态

通过 `git rev-parse --git-path concord` 定位的 SQLite、evidence 和 journal 属于当前 worktree；普通单 worktree 仓库通常落在 `.git/concord`，linked worktree 则使用自己的 Git-private 路径。缓存可清除重建；证据绑定定义、契约、候选内容和 runner 配置；journal 只用于安全恢复，不取代 Markdown 或测试源码。

## 边界

所有不可信 JSON、YAML 和缓存内容必须严格解码。路径拒绝绝对路径、traversal 与 symlink 逃逸。通用模式只承诺 command evidence，不继承任何产品专属 E2E 可靠性声明。
