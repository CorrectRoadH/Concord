# 按 Concord 规范接入软件项目

## 用户目标

维护者将有真实实现和测试的软件项目接入 Concord，以同一套 Spec、关联、Issue、Memory 与审阅规则管理开发，而不复制其它产品的仓库工具。

## 起始状态

- 一个 Git 软件项目：实现在 `src/`，测试在 `spec/`，用 `node --test` 运行。
- 仓库里没有 NiceEval 或 Nx 的产品配置、运行通道或执行器分类，也没有 Concord 文件。

## 完整路径

1. 初始化，测试不在默认位置时覆盖发现范围。 {#init}

   ```sh
   concord init --test-root spec
   ```

   init 把 `testRoots` 写进 `concord.config.ts`，其余按约定，见[渐进选择并初始化项目](../../project-onboarding/use-case/initialize-project.md#configure)。品味文件存在即生效。

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

4. agent 使用项目命令验证行为。 {#run}

   ```sh
   node --test spec/add.test.mjs
   ```

   agent 记录执行范围、结果与未验证项；Concord 的收集与关系查询不代替测试。需要原生用例身份和 label 时，可以显式 `test discover`，但不注册测试执行命令。

5. 关闭处理完的 Issue。 {#fix}

   ```sh
   concord issue close total-wrong --reason "合计不再重复计入运费；相关测试通过"
   ```

   关闭原子删除 Issue 和对应标记，不读取测试结果或 Git 历史，不要求工作区干净，流程见[用项目自己的工具验证改动](../../local-sdlc/use-case/validate-change-with-project-tools.md)。



## 结果

| 情形 | 结果 |
| --- | --- |
| 没有 NiceEval/Nx 产品配置、通道或执行器分类的软件项目 | 完成 Spec→实现/测试关联→agent 验证→Issue 关闭→审阅闭环；源码声明不被显示为执行通过 |
| 没有 `concord.config.ts` | 静态查询、trace 与 Web 照常可用 |
| 没有收集 adapter | 静态关联与 Issue 关闭不受影响 |
| 测试位于默认根之外 | 经 `testRoots` 覆盖后可以静态查询 |
| 任一入口关闭 Issue | 都只校验引用和前像，不启动测试 |
| 活跃锁、pending journal 或未知前像 | 新入口不能绕过 |
| Web 中有未提交的编辑 | 保留 |

### 验收

用打包后的 Concord 在隔离的真实 Git 接入项目中执行上表各情形，静态检查与真实闭环互不替代。验收保留未完成事务及未知编辑，不 push、不发版、不做远端写入或付费调用。
