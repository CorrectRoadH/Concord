# 在保持行为不变时重构实现

## 用户目标

维护者调整内部模块划分、函数结构或存储实现，但不改变产品对外的行为；在保持行为页与测试标记稳定的前提下，只更新架构说明与代码声明，并用现有测试验证行为未变。

## 起始状态

- `docs/feature/cart/` 已有行为页（`README.md`、`use-case/add-item.md`、`cli.md`）和实现页 `architecture.md`。
- `src/cart.js` 带有指向 `docs/feature/cart/use-case/add-item.md#add` 的代码声明，`test/cart.test.js` 带有指向同一步骤的 `@use-case` 标记。

## 完整路径

1. 查看当前关联的实现与测试。 {#inspect-current}

   ```sh
   concord --fresh show docs/feature/cart/use-case/add-item.md
   ```

   输出（节选）：

   ```text
   tests:
     neref_854212737ecad7effc4666629752cb98 — test/cart.test.js:1
       Contract: docs/feature/cart/use-case/add-item.md#add
       Declaration: active
   codeDeclarations:
     code-a7e4a2ae733e9e2c1e2b3c6da5d636f2 — src/cart.js:3–9 (node)
       Implements: docs/feature/cart/use-case/add-item.md#add
   ```

   记下守护该行为的测试关联 ID 与当前代码声明所在的源码位置。

2. 更新 `architecture.md` 与源码结构，迁移代码声明。 {#update-architecture-and-code}

   保持 `README.md`、`use-case/add-item.md` 与 `cli.md` 不变（[页面职责](../../../document-model.md#页面职责)）。在 `docs/feature/cart/architecture.md` 中更新模块职责与数据流。把 `src/cart.js` 拆分为 `src/cart/store.js` 与 `src/cart/pricing.js`，将 `@concord-implements` 代码声明随实现一起移到新文件与函数上：

   ```js
   // @concord-code
   // @concord-implements docs/feature/cart/use-case/add-item.md#add
   export function addItem(cart, sku, quantity) { ... }
   ```

   `test/cart.test.js` 中的 `@use-case` 标记保持不变。

3. 检查关系并运行关联测试。 {#verify-refactor}

   ```sh
   concord check
   concord --fresh show docs/feature/cart/use-case/add-item.md
   concord test run neref_854212737ecad7effc4666629752cb98
   ```

   `show` 反映迁移后的新源码位置，测试关联 ID 不变：

   ```text
   codeDeclarations:
     code-4f91c082d1a37b6e9012f8c3a5d71e04 — src/cart/store.js:5–11 (node)
       Implements: docs/feature/cart/use-case/add-item.md#add
   ```

   ```text
   Command pass — neref_854212737ecad7effc4666629752cb98
   Scope: command (does not prove native case coverage)
   Execution: unknown; exit: 0; cleanup: true
   ```

   `check` 校验新文件中的代码声明语法、作用域和目标有效；`test run` 通过项目配置的 runner 验证外部行为仍然通过。

## 结果

行为页与测试标记不随内部重构抖动，`trace show` 反映新的源码位置，关联测试继续通过。

| 情形 | 结果 |
| --- | --- |
| 旧源码文件删除，代码声明移入新文件 | 下一次查询按当前文件派生新的代码声明引用，不需要手工更新登记表（[一件事只写一次，其余推导](../../../taste.md#t-3)） |
| 拆分后漏掉了某个 Use Case 的代码声明 | `trace gaps` 在 `contracts` 中报告该 Use Case 缺少 `code` |
| 移动代码声明时把 `begin` / `end` 放错位置或截断语句 | `check` 报告代码声明 finding 并以退出码 1 失败 |
| 只验证内部模块不变量的测试，在重构后随内部结构调整 | 这类测试指向 `architecture.md` 或 `data-model.md` 的 anchor，与内部设计一起更新（[关联由源码声明拥有](../format.md#关联由源码声明拥有)） |
| 重构需要改变公开命令参数、输出字段或错误码 | 不属于保持行为不变的重构，先按[修改已有 Spec](evolve-existing-spec.md)更新行为页 |

## Spec 来源

- [页面职责](../../../document-model.md#页面职责)
- [从源码追踪实现归属](trace-code-ownership.md)
- [命令体验](../cli.md)
