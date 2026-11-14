# 渐进式项目初始化与品味治理

维护者想在任意 Git worktree 里直接用 Concord，不先写一堆配置。文档布局、发现范围与 Memory 位置都由约定决定，配置只用于可选收集、语言分析与少数覆盖。初始化写下项目品味，之后的功能规划、实现与审阅都遵守它。

## 你可以做什么

- 用一条 `concord init` 接入仓库：先预览完整变更，确认后才写入，已有文件保留。
- 不写配置就使用 `check`、`trace` 与 Web 工作台；需要覆盖默认值或收集原生用例时才写 `concord.config.ts`。
- 在 `docs/taste.md` 里写下项目品味，功能开发发现的通用约束经明确修订进入品味。
- 让 coding agent 从根 `AGENTS.md` 找到 Concord 指引，结合本次目标读取写作指南与完整示例。

## 上手

在一个有 `src/` 与 `test/` 的 Git 仓库顶层：

```sh
concord init
```

输出的最后几行：

```text
Start here: docs/concord.md
Writing guide: concord --skill start
Inspect configuration: concord doctor
```

检查刚初始化的项目：

```sh
concord check
```

输出（节选）：

```text
Check
ok: true
complete: true
findings: none
```

没有覆盖默认值，所以仓库里没有 `concord.config.ts`，测试与源码按约定在 `test/` 与 `src/` 中发现。

## 怎样工作

- `concord.config.ts` 可以不存在；存在时是静态 TS 数据，运行时只读取它，不执行配置模块。配置项与默认值见[项目配置文件](format.md#配置项)。
- 初始化提供渐进交互与等价的非交互输入，预览完整变更，取消不写入，保留已有文件。init 创建品味 `docs/taste.md`，系统架构入口位于 `docs/architecture.md`。
- 品味文件存在即生效，没有状态字段；其中的条目都是现行规则。Feature 可以推动品味新增、修订条目：直接编辑 `docs/taste.md`，理由写在提交说明或 Memory 中（[总则](../../taste.md#general-amend)），不把功能细节无限追加为全局规则。
- 创建 Feature 时以参数选择页面：README 必需，其余页面可选。
- 初始化指引要求 Spec 声明目标，开发过程归 Memory。`docs/` 与 `memory/` 下的全部文件都可以直接编辑；Concord 命令执行需要运行的步骤，`check` 检查结果是否一致。
- init 在根 `AGENTS.md` 中维护 Concord 的[托管区块](concepts.md#managed-block)，保留区块外正文，并引导 coding agent 从已安装版本运行 `concord --skill` 按任务读取说明。
- init 结束时让维护者把 `concord --skill start` 交给 agent：agent 结合请求与仓库现状读取对应的[写作指南](../../concepts.md#writing-guide)，仅澄清影响范围的未决目标；已明确的方向直接沿用。
- init 与 `concord skills install` 在项目中安装四个工作流 skill（`concord-spec`、`concord-implement`、`concord-review`、`concord-fix`），Claude Code 与 Codex 共用同一份文件。
- 还没有初始化的仓库里，CLI、Web 工作台与 Concord mod 都提示先初始化，不给出空的通过结果。
- Memory 固定位于 worktree 根的 `memory/`。

## 用户路径

接入：

- [渐进选择并初始化项目](use-case/initialize-project.md)
- [在还没初始化的仓库里打开 Concord](use-case/open-uninitialized-repo.md)
- [初始化后开始写 Spec](use-case/start-writing-specs.md)
- [为已有代码补写 Spec 并纳管存量测试](use-case/document-existing-code.md)

日常维护：

- [安全维护项目配置](use-case/maintain-project-config.md)
- [用工作流 skill 走开发流程](use-case/run-workflow-from-agent.md)

## 范围

不生成其它框架的应用代码，不引入远端写入或自动多后端同步，不将文档存在或代码声明称为完整合规证明。

### 接入项目采用的范式

以下规则约束[接入项目](../../concepts.md#adopting-project)。

1. Concord 规定一套工作范式，接入项目必须采用：统一 Spec 布局；Spec 先于实现；每项事实一个 owner；`docs/` 只写声明（[页面职责](../../document-model.md#页面职责)）；测试与实现通过显式源码标记关联 Spec。工程过程进入 Memory 与 Issue；Issue 处理完后删除，保留处理结论；验证由 agent 使用项目工具完成；写入遵守前像与恢复 Spec。
2. 不提供关闭事实归属、关系解释、生命周期、证据下限及安全写入不变量的配置。项目可以配置来源位置、收集适配、文档页面和写作规则参数，配置不得绕过已采用的不变量。
3. `concord check` 必须执行关系、生命周期及项目写作规则检查；检查失败或必需输入缺失时返回非零退出码，并区分违规与输入不完整。必查范围、必需规则与接入条件由[文档写作的合并检查](../documentation-quality/cli.md#合并检查)声明；定向检查或独立 profile 的结果不能替代合并检查。合并检查不成为局部读取和修复操作的前提。
4. 范式不规定技术栈。产品构建与部署、测试命令、运行环境、语言与包管理器由接入项目拥有；通用模型不要求产品包名、私有 HTTP 接口、Nx metadata 或 host/provider 分类。可选收集能力缺失只影响具体用例观察，不使静态 Spec 与关联失效。
5. 关闭 Issue 校验引用与前像，不执行测试，也不要求验证凭证、干净 Git 状态或特定提交历史。测试结果由 agent 在交付时报告，不增加统一结果格式（[验证职责](../local-sdlc/use-case/validate-change-with-project-tools.md)）。
6. 跨仓库切换仍须遵守项目身份、写互斥与恢复边界；观察或缓存不授权写入。

## 验收方式

使用打包后的公开 CLI 在隔离的 Git 接入项目中验证完整用户路径；真实测试声明关联本 Feature 的 Use Case。运行 `bun run test`，并使用 Concord 的 check、trace 与 review 检查自身 Spec 关联。

## 细节

- [项目配置文件](format.md)：`concord.config.ts` 的语法、配置项与校验错误。
- [架构](architecture.md)：配置快照、journal 与恢复授权。
- [性能预算](performance.md)：读取配置与接入诊断的预算。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [总则](../../taste.md#general-amend)
- [写现在，不写过去](../../taste.md#t-4)
