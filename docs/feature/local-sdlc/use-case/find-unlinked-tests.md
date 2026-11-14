# 找出没有关联 Use Case 的测试

## 用户目标

agent 写了一大堆测试，维护者想知道哪些测试没有说明自己在验证哪种用法，再结合断言、实现和 Spec 判断应如何处理。

## 起始状态

- 项目配置了能列出原生测试的 adapter，见[收集原生测试并关联具体用例](collect-native-tests.md)。
- 部分测试带 `@use-case` 标记，另一些没有。

## 完整路径

1. 收集框架可列举的测试。 {#discover}

   ```sh
   concord test discover
   ```

   adapter 调用框架的收集入口，记录能列举的测试及能力缺口，不派发测试体。

2. 列出没有关联的测试。 {#list}

   ```sh
   concord --json trace gaps
   ```

   预期输出（省略其它字段）：

   ```json
   {
     "operation": "trace-gaps",
     "unlinkedTests": {
       "collectedAt": "2026-10-31T09:12:04Z",
       "stale": false,
       "tests": [
         {"path": "test/cart.test.js", "nativeId": "cart > addItem handles a null sku"}
       ]
     }
   }
   ```

   `tests` 的每一项是一个原生用例：`path` 是测试文件，`nativeId` 是 adapter 给出的原生 ID，也作显示名；只有 adapter 提供位置时才有 `line`。内置的 vitest、pytest、go 与 cargo 清单不提供位置。

   清单是新鲜的（收集时的源码与当前一致）时，按现有的精确绑定判断，列出没有被任何 `@use-case` 或 `@feature` 标记绑定的原生用例。

3. 逐个决定。 {#decide}

   agent 阅读断言与相关实现，判断它守护产品行为、工程不变量，还是已不适用。确认目标后再补写缺失的 Spec 或标记；没有足够信息时保留测试并记录待查项。只有独立审阅确认无效或重复才删除，不能从“没有关联”直接推出“没用”。

## 结果

`unlinkedTests.tests` 为空只说明当前观察范围内没有报告缺关联项。仍须查看收集能力、过期状态与绑定缺口；不能推断全部测试都已关联、都有价值或行为已覆盖。

| 情形 | 结果 |
| --- | --- |
| 没有配置 adapter，或还没运行 `test discover` | `unlinkedTests` 不出现，`limitations` 说明需要先收集原生测试清单 |
| 原生清单是上一次收集的结果，测试文件之后变过 | `stale` 为 true，不做位置绑定，只按文件判断：列出当前源码中整个文件都没有 `@use-case` 或 `@feature` 标记的那些文件里的原生用例；`limitations` 说明精确判断需要先重新运行 `test discover` |
| 测试只关联了 Engineering | 不算没关联；守护仓库维护机制的测试指向 Engineering |
| 测试带 `@status retired` | 不列出 |

`unlinkedTests` 只说明没有观察到关联，不说明测试没用。是否删除由维护者判断。

## Spec 来源

- [检查关系缺口](inspect-relationship-gaps.md)
- [收集原生测试并关联具体用例](collect-native-tests.md)
