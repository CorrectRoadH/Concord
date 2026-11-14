# 收集原生测试并关联具体用例

## 用户目标

维护者想在阅读 Spec 时看到关联的具体测试，而不只是一个测试文件。Concord 收集框架的用例身份、label 和来源位置，把源码标记绑定到具体用例或参数组，供浏览、定位和检查关联缺口。

## 起始状态

- 项目已有测试框架和依赖，测试根内有指向 Spec 的 Concord 标记。
- 框架提供不执行测试体的收集方式；不能独立列举的部分如实报告能力缺口。

## 完整路径

1. 配置需要收集的测试目录。 {#configure}

   在 `concord.config.ts` 中声明，例如：

   ```ts
   export default {
     testRoots: ['test'],
     testAdapters: [{ id: 'go', include: ['test/cart'], builtin: 'go' }],
   };
   ```

   `include` 位于测试根内，各项范围不相交。内置收集 adapter 包括 `node-test`、`vitest`、`pytest`、`go`、`cargo`；只承诺经验证的收集能力，缺失能力用具名 gap 表示。外部 adapter 使用[收集协议](../cli.md#adapter-协议)。

2. 显式收集清单。 {#discover}

   ```sh
   concord --json test discover
   ```

   以下为预期输出节选；`tags` 是框架提供的 label：

   ```json
   {"nativeId":"go:go:test/cart:test/cart/cart_test.go:TestAddItem","project":"test/cart","file":"test/cart/cart_test.go","kind":"leaf","tags":{},"provenance":"go/go1.26.10"}
   ```

   框架提供参数组、完整声明范围或 label 时保留它们；不提供时报告缺口，不猜测或执行测试补齐。Go 顶层列举不证明动态子测试完整，缺少来源范围时保留 `RangeUnavailable` 与 `GoDynamicSubtestsUnknown`。

3. 把标记关联到具体用例。 {#bind}

   当前清单有可靠的完整声明范围时，Concord 按[绑定规则](../architecture.md#原生-adapter)自动绑定。缺少范围时，作者在标记块中写明清单给出的原生 ID：

   ```go
   // @use-case docs/feature/cart/use-case/add-item.md#add
   // @native go:go:test/cart:test/cart/cart_test.go:TestAddItem
   func TestAddItem(t *testing.T) { /* 测试代码 */ }
   ```

   `@native` 和 label 不改变源码标记的关联 ID。label 用于展示分类，不自动从其中创建 Spec 关系；同名、同 label 的测试不能因此合并。

4. 查看关联与缺口。 {#inspect}

   ```sh
   concord test list --json
   concord test show <关联ID> --json
   concord trace gaps --json
   ```

   [查询的 `bindings` 字段](../cli.md#具体用例绑定输出)由 Concord 派生，列表、详情与工作台展示原生身份、label、来源位置、绑定及观察的新鲜度。`trace gaps` 可列出没有标记关联的原生用例，见[未关联测试](find-unlinked-tests.md)。普通查询只读缓存，不重新收集或执行测试。

5. 需要验证行为时交给 agent。 {#handoff}

   agent 结合 Spec、源码位置和原生身份，按项目自己的方式选择并运行测试，见[用项目自己的工具验证改动](validate-change-with-project-tools.md)。Concord 不生成可执行选择 token、不提供运行按钮，也不接收结果来裁决通过。

## 结果与边界

| 情形 | 预期结果 |
| --- | --- |
| 带可靠范围的参数组 | 标记绑定到整个真实展开组，保留各项原生身份 |
| 没有范围且没有显式原生 ID | 静态关系保留，原生绑定显示未知，不猜测 |
| `@native` 不在当前清单 | `NativeBindingUnavailable`，不执行测试补齐 |
| 范围重叠或显式 ID 与可靠自动绑定冲突 | `AmbiguousNativeBinding` 或 `NativeSelectorConflict`，保留可用清单与诊断 |
| 清单过期或仓库外环境不可核验 | 标明 `current`、`complete` 与 gap，不使用过期位置作精确绑定 |
| 普通查询、关闭 Issue 或清空缓存 | 不启动收集或执行；静态关系结论不变 |
| 收集失败、超时、取消或输出截断 | 报告收集错误，不发布当前成功清单，不解释成测试失败 |
| 收集进程清理无法确认 | 阻断后续外部观察任务，文档读写与 Issue 关闭照常 |
| 框架不支持独立收集 | 报告能力缺口，保留静态标记能力；不以运行测试替代收集 |

收集可能加载测试模块和运行列举所需的编译步骤，调用者须信任项目与 adapter。Concord 管理自己的收集进程和产物；它不保证加载测试模块没有副作用。

对支持的框架验证真实收集、label、身份、位置、绑定和进程终结；只在外部程序边界使用 fake。收集验收不要求实现测试执行适配，不证明测试通过或覆盖率。

## Spec 来源

- [命令与收集协议](../cli.md#原生测试-adapter)
- [绑定与收集资源生命周期](../architecture.md#原生-adapter)
