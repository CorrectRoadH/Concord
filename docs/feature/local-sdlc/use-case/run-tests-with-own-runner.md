# 用自己的执行器接入 Concord

## 用户目标

项目已经有自己的测试执行器，例如先打包候选、在隔离目录安装、再跑正式 E2E 的工具。维护者想让 Concord 知道这些用例、按 Spec 关联它们、只运行指定的用例并据此核验修复，而不必改用 Concord 内置的 runner，也不在执行器里引入 Concord 的代码。

## 起始状态

- 项目已运行 `concord init`，Concord 从[发版归档](../../cross-platform-release/README.md)安装，项目的依赖里没有 Concord 的包。
- 正式 E2E 在 `e2e/` 下，由项目的执行器 `tools/e2e-adapter.mjs` 运行；用例写在 `e2e/cart/add-item.e2e.ts`：

  ```ts
  // @use-case docs/feature/cart/use-case/add-item.md#add
  test('adds the same SKU twice', async () => { ... });
  ```

## 完整路径

1. 取得协议的 Schema。 {#schema}

   ```sh
   concord schema test-adapter > tools/concord-test-adapter.schema.json
   ```

   执行器从 stdin 读一个 JSON 请求，向 stdout 写一个 JSON 响应，用这份 JSON Schema 校验两者。Schema 随 CLI 版本输出，升级 Concord 后重新取得；执行器用什么语言写都可以。

2. 把执行器声明为 adapter。 {#configure}

   ```ts
   testAdapters: [{
     id: 'e2e',
     include: ['e2e'],
     argv: ['node', 'tools/e2e-adapter.mjs'],
     implementationFiles: ['tools/e2e-adapter.mjs'],
     inputRoots: ['e2e'],
     frameworkVersion: 'e2e-adapter/1',
     lockFiles: ['pnpm-lock.yaml'],
     envNames: ['PATH', 'HOME'],
   }],
   ```

   `implementationFiles`、`inputRoots` 与 `lockFiles` 告诉 Concord 哪些文件决定这个执行器的结果，输入身份由 Concord 计算。字段与上限见 [adapter 协议](../cli.md#adapter-协议)。

3. 让 Concord 收集用例。 {#discover}

   ```sh
   concord --json test discover
   ```

   Concord 先发 `collect-plan`，执行器返回要运行的收集命令；Concord 运行它们，再发 `collect-parse`，执行器把输出解析成原生用例清单。执行器只描述它看到的用例，不计算 Concord 的用例 ID。

4. 读取用例 ID。 {#list}

   ```sh
   concord --json test list
   ```

   每个带标记的用例有一个 `neref_…` 形式的 case ID，由 Concord 从标记计算。脚本、CI 与执行器需要用例 ID 时都从这里读取，不自行推导。

5. 只运行一个用例。 {#run}

   ```sh
   concord test run neref_7aff36b4a3eda34d7d577e8eeacac0e8 --require-native
   ```

   Concord 发 `select-plan`，执行器返回只运行选中用例的命令；Concord 执行命令、记录退出码与清理状态，再发 `report-parse` 取得逐项结果。裁决 green、red 或 invalid 由 Concord 作出，执行器的响应不能覆盖命令的退出状态。

6. 用同一条路径核验修复。 {#verify}

   ```sh
   concord issue close duplicate-sku --fixed
   ```

   修复核验在缺陷提交与修复提交上各运行一次这个用例，收据由 Concord 产生和保存（[核验修复并关闭缺陷](resolve-with-command-evidence.md)）。

## 结果

| 情形 | 看到什么 |
| --- | --- |
| 执行器的响应不符合 Schema | `AdapterProtocolInvalid`，本次收集或运行无效 |
| 选中的用例缺失、重复或被跳过 | 裁决为 invalid，不能作为修复核验的任何一端 |
| 执行器自己的证据，例如重复运行的可靠性结论 | 由项目自己保存与解释；Concord 不签发、不核验，也不把它当作修复证据 |
| 项目依赖里安装了 Concord 的包或导入其模块 | 不受支持；Concord 只以 CLI 交付 |

### 验收方式

- 在临时仓库中用一个最小的外部执行器（非 TypeScript 实现）走完第 2 到第 6 步，`test list` 的 case ID 与 `test run` 的选择一致。
- `concord schema test-adapter` 的输出能校验协议的全部请求与响应示例，未知字段被拒绝。
- 执行器返回不符合 Schema 的响应、或漏报选中的用例时，结果分别为 `AdapterProtocolInvalid` 与 invalid。
