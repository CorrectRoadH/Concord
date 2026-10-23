---
format: concord.document/v1
id: inspect-relationship-gaps
title: 检查契约与 CLI 页面的实现和测试关系缺口
createdAt: 2026-09-21T00:00:00.000Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 检查契约与 CLI 页面的实现和测试关系缺口

## 用户目标

维护者和 Agent 在修改功能前，要一次看到哪些 Feature、Use Case 和 CLI 页面还没有实现或测试关联，先补契约，再规划实现与验收。

## 起始状态

- 项目已有 Feature 与 Use Case，部分源码与测试带有 Concord 标记。

## 完整路径

1. 列出缺口。 {#list-gaps}

   ```sh
   concord --fresh --json trace gaps
   ```

   ```json
   {
     "operation": "trace-gaps",
     "semantics": "missing-explicit-relationships-not-coverage",
     "limitations": ["Only documented CLI pages are discoverable; undocumented commands require a product-owned inventory."],
     "contracts": [{"path": "docs/feature/cart/use-case/add-item.md", "kind": "use-case", "title": "加入商品", "missing": ["code"], "relationships": {"code": 0, "test": 1}}],
     "cliPages": [{"path": "docs/feature/cart/cli.md", "feature": "docs/feature/cart/README.md", "title": "购物车", "missing": ["code", "test"], "relationships": {"code": 0, "test": 0}}],
     "unmarkedLists": []
   }
   ```

   不加 `--fresh` 且尚无快照时返回 `QueryPending`。

2. 对 `contracts` 中的条目，补实现标记（`missing` 含 `code`）或测试标记（`missing` 含 `test`）。 {#fill-contracts}

3. 对 `cliPages` 中的条目，让实现或测试直接指向该页面或页面内的 anchor，例如 `// @concord-implements docs/feature/cart/cli.md#<标题 anchor>`。 {#fill-cli}

4. 先改 Feature、Use Case、CLI 页面或必要的 Design，再改代码与测试，然后重新运行 `trace gaps`、`check` 和项目自己的质量检查。 {#recheck}

## 结果

- `contracts` 与 `cliPages` 分开列出，每项用 `missing` 说明缺少的是 `code` 还是 `test`，用 `relationships` 给出现有数量。
- Feature 的计数包含自身、附页与所属 Use Case。Use Case 只计自身。CLI 页面只计直接指向该页面或其 anchor 的关系，指向 Feature 的关系不算。
- 退役（`@status retired`）的测试不算测试关系。无效的 owner 或标记先由 `check` 的 finding 报告。
- `unmarkedLists` 列出 Use Case 中含未标记步骤的有序列表。

## 边界

- 结果只表示 Concord 没有观察到显式关系。它不是代码覆盖率或命令覆盖率，也不说明功能缺失或测试未执行。`semantics` 字段固定说明这一点。
- 只能审计已有的 CLI 页面。没有页面的命令不会出现，需要由产品自己的命令清单或评审补上，`limitations` 字段说明这一点。

## 契约来源

[本地 SDLC 闭环](../README.md)。关系由实现与测试源码中的标记拥有，本页不维护反向登记表。
