# 修改已有 Spec 并更新实现与测试

## 用户目标

产品的某项行为需要修改或删减时，维护者和 agent 先改 Use Case，再顺着反向关系找到受影响的实现与测试，更新代码、调整或退役旧测试，使 Spec、实现与测试保持一致。

## 起始状态

- 项目已初始化，已有 `docs/feature/cart/use-case/add-item.md`。
- `src/cart.js` 与 `test/cart.test.js` 带有指向该 Use Case 及其步骤 `{#add}`、`{#merge}` 的代码声明与测试标记。

## 完整路径

1. 查看这个 Use Case 关联的实现与测试。 {#inspect-links}

   ```sh
   concord --fresh show docs/feature/cart/use-case/add-item.md
   ```

   输出（节选）：

   ```text
   tests:
     neref_854212737ecad7effc4666629752cb98 — test/cart.test.js:1
       Contract: docs/feature/cart/use-case/add-item.md#add
       Declaration: active
     neref_3190ac4102b8e4f9120c77d24e8a9103 — test/cart.test.js:8
       Contract: docs/feature/cart/use-case/add-item.md#merge
       Declaration: active
   codeDeclarations:
     code-a7e4a2ae733e9e2c1e2b3c6da5d636f2 — src/cart.js:3–9 (node)
       Implements: docs/feature/cart/use-case/add-item.md#add
   ```

   输出列出当前指向该 Use Case 及各步骤的 `tests` 与 `codeDeclarations`，作为本次改动的影响范围。只改某一步时，也可以直接传 `<路径>#<step-id>`（例如 `concord --fresh show docs/feature/cart/use-case/add-item.md#merge`），只看直接指向这一步的测试与代码声明。

2. 先修改 Use Case，再检查断开的引用。 {#update-spec}

   直接编辑 `docs/feature/cart/use-case/add-item.md`，修改步骤说明与结果表。删掉不再保留的步骤 `{#merge}` 后运行检查：

   ```sh
   concord check
   ```

   ```text
   check
   ok: false
   complete: false
   findings:
     test/cart.test.js:8
       AnchorNotFound: Anchor merge does not exist in docs/feature/cart/use-case/add-item.md
   ```

   检查指出仍指向旧步骤的文件和行。实现中途若发现 Spec 缺失或与代码事实冲突，先停下受影响的实现，回到本步补全 Spec 或通过[记下一个还没定的取舍](compare-design-plans.md)拍板后再继续（[Spec 随时可改](../../../taste.md#t-12)）。

3. 更新实现，调整测试或将旧测试标为退役。 {#update-code-and-tests}

   按修改后的 Use Case 更新 `src/cart.js` 的实现与代码声明，以及 `test/cart.test.js` 中的断言和标记目标。如果某条历史测试仍留在测试文件中，但不再验证当前 Use Case，在它的标记块中加上 `@status retired` 并把目标改到仍存在的 Use Case：

   ```js
   // @use-case docs/feature/cart/use-case/add-item.md
   // @status retired
   test('legacy merge behavior', () => { ... });
   ```

   把行为页中受影响的输出示例更新为新实现的实际运行输出。

4. 重新检查关系、缺口并运行关联测试。 {#verify-updated-links}

   ```sh
   concord check
   concord --fresh trace gaps cart
   ```

   ```text
   check
   ok: true
   complete: true
   findings: none
   ```

   `check` 核对引用和写作规则，`trace gaps cart` 提供缺少关联的提示；agent 结合 Spec 与源码判断测试范围，使用项目命令验证行为。关联缺口不证明功能缺失，退役标记不改变项目测试工具的运行方式。

## 结果

Use Case、实现代码与测试标记同步到新行为，断开的旧引用被全部清理。

| 情形 | 结果 |
| --- | --- |
| 删掉步骤或标题后，源码或测试仍指向旧 anchor | `check` 报告 `AnchorNotFound`，退出 1 |
| 删掉整个 Use Case 或 Feature，源码或测试仍指向原路径 | `check` 报告 `ReferenceNotFound`，退出 1 |
| 给步骤改名，希望自动改写源码与测试引用 | 使用 [`concord use-case rename-step`](link-tests-to-steps.md#rename-step) |
| 把 Use Case 移到其它 Feature 或给文档包改名 | 使用 [`concord move`](move-spec-documents.md) |
| 测试标记块带有 `@status retired` | `show` 与 `review` 将其列为 `retired`；它不计入 `trace gaps` 的有效测试关系，也不出现在 `unlinkedTests` |
| 实现中途发现未定义的边界或与既有系统冲突 | 暂停依赖该边界的实现，先改 Spec 或写 Design 请维护者决定，再按最新 Spec 调整代码（[Spec 写到实现者不用再问](../../../taste.md#t-11)） |

## Spec 来源

- [本地 SDLC 闭环](../README.md)
- [命令体验](../cli.md)
- [文档与标记格式](../format.md)
