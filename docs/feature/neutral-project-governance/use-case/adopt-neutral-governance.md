# 按 Concord 规范接入软件项目

## 用户目标

维护者将有真实实现和测试的软件项目接入 Concord，以同一套 Spec、关联、Issue、Memory 与审阅规则管理开发，而不复制其它产品的仓库工具。

## 起始状态

- 一个 Git 软件项目：实现在 `src/`，测试在 `spec/`，用 `node --test` 运行。
- 仓库里没有 NiceEval 或 Nx 的产品配置、运行通道或执行器分类，也没有 Concord 文件。

## 完整路径

1. 初始化，测试不在默认位置时覆盖发现范围，需要运行测试时配置 runner。 {#init}

   ```sh
   concord init --test-root spec --runner-config runner.json
   ```

   `runner.json` 为 `{"kind":"command","argv":["node","--test","{file}"],"sourceFiles":[],"timeoutMs":60000}`。init 把 `testRoots` 与 `runner` 写进 `concord.config.ts`，其余按约定，见[渐进选择并初始化项目](../../project-onboarding/use-case/initialize-project.md#runner)。品味文件存在即生效。

2. 写 Feature 与 Use Case，给测试加标记。 {#link}

   Use Case `docs/feature/cart/use-case/total.md` 的第一步带 `{#add}`。生成标记：

   ```sh
   concord test marker --contract 'docs/feature/cart/use-case/total.md#add'
   ```

   ```text
   // @use-case docs/feature/cart/use-case/total.md#add
   ```

   把它放在 `spec/add.test.mjs` 的测试上方。实现用代码声明引用 canonical Spec。

3. 查看关系。 {#trace}

   ```sh
   concord --fresh show total
   ```

   输出（节选）：

   ```text
   tests: 
     neref_7c0a61a1e94b429fafcb4e49eb734a90 — spec/add.test.mjs:5
       Contract: docs/feature/cart/use-case/total.md#add
       Declaration: active
   ```

   查询、trace 与 Web 从权威源码派生关系，不隐式运行测试，也不因项目没有某个产品的通道、包名或 host 而失败。`Declaration: active` 只表示标记存在，不表示测试通过。

4. 通过项目的 runner 运行测试。 {#run}

   ```sh
   concord test run neref_7c0a61a1e94b429fafcb4e49eb734a90
   ```

   ```text
   Command pass — neref_7c0a61a1e94b429fafcb4e49eb734a90
   Scope: command (does not prove native case coverage)
   Execution: unknown; exit: 0; cleanup: true
   Timeout: false; cancelled: false; signal: null
   Arguments: ["node","--test","spec/add.test.mjs"]
   ```

   结果只按 runner 退出码解释，不声称逐 case 覆盖或正式可靠性。

5. 缺陷记为 Issue，先提交失败的回归测试，再提交修复，以 fixed 关闭。 {#fix}

   ```sh
   concord issue close total-wrong --fixed --reason "合计不再重复计入运费"
   ```

   关闭前通过[修复核验](../../local-sdlc/README.md#证据的范围)，完整步骤见[核验修复并关闭缺陷](../../local-sdlc/use-case/resolve-with-command-evidence.md)。缺测试、缺提交、区间含 merge 或 shallow clone 时具名返回 `FixUnverifiable`。

## 结果

| 情形 | 结果 |
| --- | --- |
| 没有 NiceEval/Nx 产品配置、通道或执行器分类的软件项目 | 完成 Spec→实现/测试关联→执行→Issue 修复核验→审阅闭环；源码声明不被显示为执行通过 |
| 没有 `concord.config.ts` | 静态查询、trace 与 Web 照常可用 |
| 缺少 `runner` | 只阻断测试运行与修复核验 |
| 测试位于默认根之外 | 经 `testRoots` 覆盖后可以静态查询 |
| 任一入口写入 fixed 关闭 | 都带核验结论 |
| 删除 runner 配置 | 不能使没有核验的 fixed 通过检查 |
| 活跃锁、pending journal 或未知前像 | 新入口不能绕过 |
| Web 中有未提交的编辑 | 保留 |

### 验收

用打包后的 Concord 在隔离的真实 Git 消费仓库中执行上表各情形，静态检查与真实闭环互不替代。验收保留未完成事务及未知编辑，不 push、不发版、不做远端写入或付费调用。
