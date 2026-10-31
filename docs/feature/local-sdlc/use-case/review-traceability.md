# 追踪 Spec 并生成审阅材料

## 用户目标

Reviewer 要从一份 Feature 或整个项目出发，看到 Spec、附页、Use Case、测试、代码声明、Issue、Memory 与修复核验之间的关系，判断这次变更有没有可审阅的验收依据。

## 起始状态

- 项目已有 Spec，源码与测试带有 Concord 标记。

## 完整路径

1. 检查全部关系。 {#check}

   ```sh
   concord --json trace check
   ```

   ```json
   {"operation":"trace-check","ok":true,"complete":true,"findings":[],"edges":[
     {"from":"docs/feature/cart/use-case/add-item.md","to":"docs/feature/cart/README.md","relation":"feature"},
     {"from":"case:neref_854212737ecad7effc4666629752cb98","to":"docs/feature/cart/use-case/add-item.md","relation":"contract"},
     {"from":"case:neref_854212737ecad7effc4666629752cb98","to":"docs/issues/duplicate-sku.md","relation":"issue"},
     {"from":"code:code-68054071298e32ca5ef1a72ca3a117d2","to":"docs/feature/cart/README.md","relation":"implements"}]}
   ```

   `trace check` 校验引用目标存在、类型正确、没有重复与循环。有问题时 `ok` 为 false，退出 1。

2. 查看一份 Spec 的关系。 {#show}

   ```sh
   concord --fresh trace show docs/feature/cart/README.md
   ```

   结果只包含这份 Feature、精确指向其附页或 anchor 的关系，以及所属 Use Case 的关系。输出字段见 [CLI](../cli.md#追踪关系)。

3. 生成审阅材料。 {#render}

   ```sh
   concord --fresh review
   ```

   ```markdown
   # Concord review

   This is local review material. Code declarations describe implementation associations, not completion or test coverage. Test annotations describe ownership; fix verification does not prove native case coverage.

   ## Contracts and decisions

   - 购物车 — feature
   - 加入商品 — use-case

   ## Code declarations

   - **src/cart.js:1–6** — src/cart.js:1–6; file
     - Implements: docs/feature/cart/README.md

   ## Test declarations

   - **neref_854212737ecad7effc4666629752cb98** — test/cart.test.js:5; active; contract: docs/feature/cart/use-case/add-item.md
     - Issue: docs/issues/duplicate-sku.md

   ## Issues

   - 重复加入覆盖数量 — open
   ```

   `review <feature>` 只生成一份 Feature 的材料。完整输出还包含品味状态、Use Case 步骤分组与本地反馈。

4. Reviewer 从材料中的链接回到 Spec 与源码，核对正文。 {#read-sources}

## 结果

- 目录名前缀相似的相邻 Feature 不会混入。
- 删除、改名或退役测试后，下一次 `trace` 立即反映当前源码。
- fixed 缺少修复核验、`unknown` 执行结果和修复核验的边界在材料中明确写出，不当作覆盖率。
- 这些命令都不运行测试，不发送到 GitHub，也不修改远端。

## Spec 来源

- 命令与输出：[CLI](../cli.md#追踪关系)
