# 把测试关联到 Use Case 步骤

## 用户目标

测试维护者和 reviewer 想把测试和实现关联到 Use Case 完整路径中的某一步，看到每一步由哪些测试与代码声明关联，并找出还没有关联的步骤。

## 起始状态

- 项目已初始化，`docs/feature/cart/use-case/add-item.md` 的完整路径是一个还没有步骤 ID 的有序列表：

  ```markdown
  1. 打开商品页。
  2. 点“加入购物车”。
  3. 看到购物车数量加一。
  ```

- `src/` 与 `test/` 中还没有指向这个 Use Case 的标记。

## 完整路径 {#主流程}

1. 给完整路径加上步骤 ID。 {#declare-steps}

   先看 Use Case 里有哪些根有序列表：

   ```sh
   concord use-case steps docs/feature/cart/use-case/add-item.md
   ```

   ```text
   use case steps
   path: docs/feature/cart/use-case/add-item.md
   steps: none
   lists: 
     ordinal: 1
     line: 9
     endLine: 11
     items: 3
     marked: 0
   ...
   ```

   这个列表还没有任何 ID，`format` 不按章节名称猜它是不是完整路径，要用 `--seed --list <ordinal>` 显式选中：

   ```sh
   concord use-case format docs/feature/cart/use-case/add-item.md --seed --list 1
   ```

   ```text
   Applied format-use-case:
     docs/feature/cart/use-case/add-item.md

   Next: concord check.
   ```

   每一项第一段末尾多了 `{#step-1}`、`{#step-2}`、`{#step-3}`。也可以直接手写 `{#id}`，写法见[步骤语法](../format.md#步骤语法)。列表里已有部分 ID 时，不带参数的 `use-case format` 只补齐缺失的那几项。

2. 把测试和实现指向一步。 {#link-declarations}

   ```sh
   concord test marker --contract 'docs/feature/cart/use-case/add-item.md#step-2'
   concord code marker --scope node --contract 'docs/feature/cart/use-case/add-item.md#step-2'
   ```

   ```text
   // @use-case docs/feature/cart/use-case/add-item.md#step-2
   // @concord-code
   // @concord-implements docs/feature/cart/use-case/add-item.md#step-2
   ```

   把第一行放在测试上方，后两行放在实现函数上方，然后运行 `concord check`。`check` 校验步骤位置、ID 命名空间与引用目标；指向标题 anchor 或整个 Use Case 的已有关联继续有效。

3. 查看每一步的关联。 {#inspect-associations}

   ```sh
   concord use-case steps docs/feature/cart/use-case/add-item.md
   ```

   ```text
   ...
     id: step-2
     ordinal: 2
     line: 10
     endLine: 10
     listOrdinal: 1
     ref: docs/feature/cart/use-case/add-item.md#step-2
     tests: 
       neref_efa3bb79b56638332d3b21a4d7851bca — test/cart.test.js:1
         Contract: docs/feature/cart/use-case/add-item.md#step-2
         Declaration: active
     codeDeclarations: 
       code-a7b4b04f800d841c8d0c3c7e0163e1f2 — src/cart.js:3–3 (node)
         Implements: docs/feature/cart/use-case/add-item.md#step-2
   ...
   unassociatedSteps: 
     docs/feature/cart/use-case/add-item.md#step-1
     docs/feature/cart/use-case/add-item.md#step-3
   ```

   `trace show` 与 `review` 按同样的分组列出测试与代码声明，另列整个 Use Case 和非步骤 anchor 的关联；`--json` 的分组字段见[步骤分组输出](#步骤分组输出)。没有关联的步骤单独列出。`trace gaps` 的 `unmarkedLists` 提示含未标记项的根有序列表。

4. 给步骤改一个有意义的 ID。 {#rename-step}

   先预览：

   ```sh
   concord --json --dry-run use-case rename-step docs/feature/cart/use-case/add-item.md step-2 add
   ```

   ```json
   {"operation":"rename-step","dryRun":true,"changedPaths":["docs/feature/cart/use-case/add-item.md","src/cart.js","test/cart.test.js"],"affectedCases":[{"before":"neref_7c4db47f290d5d4ae84a329d0e7a32d4","after":"neref_c819fd741de96b66d582d3d035066ef9","file":"test/cart.test.js","named":false}],"evidence":"Previous receipts cannot be reused for the renamed target"}
   ```

   去掉 `--dry-run` 再运行一次：

   ```text
   Applied rename-step:
     docs/feature/cart/use-case/add-item.md
     src/cart.js
     test/cart.test.js

   Next: concord check.
   ```

   正文的 `{#step-2}`、测试与实现标记以及指向它的 Markdown 链接在一个可恢复的变更集中一起改写。`--dry-run` 执行同一规划与校验。Issue 与 Memory 关系中的引用须先由作者修改。改写规则见[Use Case 步骤](../cli.md#use-case-步骤)。

## 结果

每一步都能回答“哪些测试和代码在守护它”，没有关联的步骤一眼可见。

| 情形 | 结果 |
| --- | --- |
| 改步骤文字、插入或移动其它项 | 步骤引用不变，只有 ordinal 变化 |
| 三个步骤中两个有测试 | 剩下的一步列在 `unassociatedSteps`，`check` 不失败 |
| 没有步骤的 Use Case | 不产生 finding |
| 不同语言章节下带 `{#reject-token}` 的顶层有序项 | 可以导航 |
| `{#id}` 写在无序项、嵌套项或附页中 | `check` 报告 `InvalidStepPosition`，不移动文本 |
| 代码示例中的 `{#id}`；没有 ID 的其它列表 | 不是步骤，不进入步骤视图 |
| 标记指向的步骤 ID 不存在 | `check` 报告 `AnchorNotFound: Anchor checkout does not exist in docs/feature/cart/use-case/add-item.md`，退出 1 |
| 源码注释引用（`// @spec`）指向不存在的步骤或 anchor | `check` 报告 `AnchorNotFound`，退出 1 |
| 文档中的本仓库 GitHub 链接指向不存在的页面或 anchor | `check` 报告 `ReferenceNotFound` 或 `AnchorNotFound`，退出 1 |
| 带 `@name` 的标记从文件改为步骤目标 | 测试关联 ID 不变 |
| 原生标签写错且没有 Concord 标记 | 不产生关联 |
| 冷、热、损坏与清空缓存 | `check` 的当前关系、finding、退出码与 `complete` 一致 |
| 测试直接调用声明同一步骤的实现 | 相关性为 `observed`，level 为 `step` |
| 实现只被另一 case 导入、经辅助函数转调，或只有其它 Feature 的声明 | 不冒充该 case 的行为证明 |
| 测试经构建 CLI 子进程或 HTTP 调用实现，没有分析器，或达到闭包上限 | `not-observed`，并给出原因 |
| 再次运行 `use-case format` | 零写入；删除最大序号后不分配被标题或旧引用占用的值 |
| `--seed` 没有给出 `--list`，或 `--list` 不存在 | `InvalidStepList`，退出 1 |
| `new-id` 与同文件的 anchor 或步骤冲突 | `DuplicateAnchor`，零写入 |
| Issue 或 Memory 仍引用旧步骤 | `ManagedReferenceBlocked`，零写入 |
| 规划后修改任一输入 | 零写入 |
| 在首个文件发布后中断 | 下一个命令启动的服务先回滚，再执行该命令 |
| 在 committed journal 持久化后中断 | 下一个命令启动的服务先完成改写，再执行该命令 |

验收以构建打包后的 CLI 在隔离 Git 消费者中进行，步骤导航与依赖观察分别验收：使用已知正误声明的直接调用与子进程样本，逐个公开观察结果和缺口，不设未知结果比例目标。

## 步骤分组输出

`trace show --json` 的 `stepGroups` 按 Use Case 分组，包含 `steps`、`wholeUseCase`、`nonStepAnchors` 与 `unassociatedSteps`。每个关联组的 `relevance` 按 `testId` 返回当前观察的 `scope`、判定和缺口；步骤同时保留声明数量。

组级 `observation.result` 在任一测试观察到交集时为 `observed`，否则为 `not-observed`；`gaps` 合并各测试的限制。没有可用分析时返回 `NoAnalyzer`。组级结果不表示所有步骤或测试均已观察到交集，也不证明执行或覆盖。

历史投影中的相关性不授权当前输入。读取历史投影时，已有观察降为非当前，相关性返回 `not-observed` 与 `SnapshotNotCurrent`；当前结果需通过 fresh 读取复核输入。

## Spec 来源

- 步骤的写法：[步骤语法](../format.md#步骤语法)
- 命令规则：[Use Case 步骤](../cli.md#use-case-步骤)
- 步骤与关联的身份：[关联身份与观察](../format.md#关联身份与观察)
- 改写的发布：[步骤改写的发布](../architecture.md#步骤改写的发布)
