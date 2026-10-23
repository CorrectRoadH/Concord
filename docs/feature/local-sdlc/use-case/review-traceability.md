---
format: concord.document/v1
id: review-traceability
title: 追踪契约并生成审阅材料
createdAt: 2026-09-13T11:00:37.386Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 追踪契约并生成审阅材料

## 用户目标

Reviewer 要从一份 Feature 或整个项目出发，看到契约、附页、Use Case、测试、代码声明、Memory 与证据之间的关系，判断这次变更有没有可审阅的验收依据。

## 起始状态

- 项目已有契约，源码与测试带有 Concord 标记。

## 完整路径

1. 检查全部关系。 {#check}

   ```sh
   concord --json trace check
   ```

   ```json
   {"operation":"trace-check","ok":true,"complete":true,"findings":[],"edges":[
     {"from":"docs/feature/cart/use-case/add-item.md","to":"docs/feature/cart/README.md","relation":"feature"},
     {"from":"case:neref_854212737ecad7effc4666629752cb98","to":"docs/feature/cart/use-case/add-item.md","relation":"contract"},
     {"from":"case:neref_854212737ecad7effc4666629752cb98","to":"memory/duplicate-sku.md","relation":"regression"},
     {"from":"code:code-68054071298e32ca5ef1a72ca3a117d2","to":"docs/feature/cart/README.md","relation":"implements"}]}
   ```

   `trace check` 校验引用目标存在、类型正确、没有重复与循环。有问题时 `ok` 为 false，退出 1。

2. 查看一份契约的关系。 {#show}

   ```sh
   concord --fresh trace show docs/feature/cart/README.md
   ```

   结果只包含这份 Feature、精确指向其附页或 anchor 的关系，以及所属 Use Case 的关系。输出字段见 [CLI](../cli.md#追踪关系)。

3. 生成审阅材料。 {#render}

   ```sh
   concord --fresh review render
   ```

   ```markdown
   # Concord review

   This is local review material. Code declarations describe implementation associations, not completion or test coverage. Test annotations describe ownership; command evidence does not prove native case coverage.

   ## Contracts and decisions

   - [购物车](docs/feature/cart/README.md) — feature
   - [加入商品](docs/feature/cart/use-case/add-item.md) — use-case

   ## Code declarations

   - **src/cart.js:1–6** — [src/cart.js:1–6](src/cart.js#L1); file
     - Implements: [docs/feature/cart/README.md](docs/feature/cart/README.md)

   ## Test declarations

   - **neref_854212737ecad7effc4666629752cb98** — [test/cart.test.js:5](test/cart.test.js#L5); active; contract: [docs/feature/cart/use-case/add-item.md](docs/feature/cart/use-case/add-item.md)
     - Regression: [memory/duplicate-sku.md](memory/duplicate-sku.md)

   ## Engineering memory

   - [重复加入覆盖数量](memory/duplicate-sku.md) — problem, open, epoch 1
   ```

   `review render <feature>` 只生成一份 Feature 的材料。完整输出还包含宪法状态、Use Case 步骤分组与本地反馈。

4. Reviewer 从材料中的链接回到契约与源码，核对正文。 {#read-sources}

## 结果

- 目录名前缀相似的相邻 Feature 不会混入。
- 删除、改名或退役测试后，下一次 `trace` 立即反映当前源码。
- 证据缺失、`unknown` 执行结果和命令证据的边界在材料中明确写出，不当作覆盖率。
- 这些命令都不运行测试，不发送到 GitHub，也不修改远端。

## 契约来源

- 命令与输出：[CLI](../cli.md#追踪关系)
