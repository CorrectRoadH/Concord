# 使用 Concord 开发

Concord 以 Spec 驱动开发：人审阅 Spec 的变化，agent 按 Spec 实现并用测试证明，Concord 检查三者是否一致（[为什么需要 Concord](why-concord.md)）。

先运行 `concord --skill` 读取短入口，再按任务运行 `concord --skill <topic>`；完整离线资料使用 `concord --skill all`。

## 直接编辑，门禁把关

`docs/` 与 `memory/` 下的全部文件都直接编辑，包括 Issue 的状态与关闭结论、Memory 的状态与关系。Concord 从文件派生索引与反向关系，不维护人工 INDEX。命令是执行需要运行的步骤的助手，例如修复核验、Design 裁决与 Roadmap 采用；CI 对每个变化运行 `concord check --since <base>`，检查变化是否合法（[事实归属](document-model.md#事实归属)）。命令面见 [CLI](feature/local-sdlc/cli.md)。

## 本仓库的自举用法

Concord 用当前 checkout 构建并 link 的公开 CLI 维护自身 Spec，入口报告的版本与 `package.json` 一致。项目 runner 为：

```text
node --import tsx --test --test-name-pattern {pattern} {file}
```

维护文档前阅读[本地 SDLC 闭环](feature/local-sdlc/README.md)与 [Concord 自举维护](engineering/concord-self-hosting/README.md)。

新增或调整测试时，在测试文件里放置 `@feature <canonical path>` 或 `@use-case <canonical path>`，可附加 `@issue` 和 `@status`。标记存在即构成关联，测试 ID 由文件和标记派生。测试回调通过 `Effect.runPromise` 执行 Effect program。

日常自举检查：

```text
concord doctor
concord check
concord test list
concord trace check
concord show local-sdlc
concord review render local-sdlc
```

`concord check` 汇总关系、生命周期和写作检查，均不执行 runner。仓库质量门是 `pnpm check`。测试运行与修复核验只按 runner 的退出码解释结果，不是正式 E2E，也不是逐 case 覆盖证明；项目与 Concord 在测试上的分工见[项目测试接入边界](repository-profile.md)。

## 关联实现与 Spec

`sourceRoots` 默认取存在的 `src/`，实现在其它位置时在 `concord.config.ts` 配置，或用 `--source-root` 初始化，选项可重复。运行 `concord --skill code` 查看文件、函数和语句区域声明。

`code annotate` 生成注释，`code locate <path> --line <n>` 查看全部包含范围，`trace show` 反查 Spec。代码声明描述实现关联，不表示完成或测试覆盖。

## 选择文档的分组

文档按回答的问题分组，位置与字段见[文档模型](document-model.md)：

- Spec：[Feature](feature/README.md) 是已采用的产品 Spec，实现可以尚在追赶；[Engineering](engineering/README.md) 是本仓库的测试与维护机制。
- 提案：[Roadmap](roadmap/README.md) 是与 Feature 同体裁、尚未采用的方向。
- 项目规则：[宪法](constitution.md)、术语与写作政策。
- 决策记录：[Design](design/README.md) 是目标、约束、自包含候选与裁决理由；[Research](research/README.md) 是决策所需的外部事实与来源。
- 工作项：[Issue](issues/README.md) 是缺陷、请求与观察。
- 知识：[Memory](../memory/README.md) 是可复用的知识与不需要 Design 的决策。

`docs/` 只写声明：目标、行为、约束、使用方法与验收条件，产品流程属于 Spec。开发日志、排障经过与实施进度不进入 `docs/`。模板提供写作提示，不代表需求完成或证据。行为页与实现页的分工、关联范围的选择写在宪法 [关联由源码声明拥有](feature/local-sdlc/library.md#关联由源码声明拥有) 与 [页面职责](document-model.md#页面职责)，接入项目统一遵守（[决策依据](design/contract-writing/DECISION.md)）。

现行行为只读 Feature、Use Case、architecture 与 engineering 页。已裁决的 Design 是决策记录：裁决时把仍适用的规则写入这些页面，此后只在这里维护；Design 只在重新审视某项决策时读取（[Design 记录](document-model.md#design-记录)）。

## 初始化

init 建立全部分类目录、文档入口和完整的[模板参考](_template/README.md)。`concord.config.ts` 可以不存在，只在需要 runner 或覆盖默认目录时配置。

Feature、Roadmap 与每个 Design 候选必须有 README。`new` 的 `--pages` 从 `library`、`cli`、`architecture`、`use-case` 中选择其余页面，省略时只建 README。Design 外层页面总是创建，Engineering 从 README 开始按主题扩展。之后需要的页面直接创建，并在 README 中链接。

## 项目宪法

规划、实施或审阅功能前阅读[宪法](constitution.md)。依据某条规则的句子旁链接其条款或款的 ID，`concord check` 校验这些链接。

宪法可以直接编辑。修订 active 宪法时，同一变化中写一条 decision 类型的 Memory，记录适用范围、理由、来源与影响，并以 `amends` 指向受影响的条款与款；宪法本身只声明当前规则（[总则](constitution.md#general-amend)）。`concord constitution show` 查看正文、条款与款，以及每处引用位置；`adopt` 与 `amend` 写入同样的内容。draft 模板不表示合规。

## 第一个 Feature

```text
concord new feature login --title "Login" --pages use-case
concord new use-case expired-token --feature login --title "Reject expired tokens"
```

然后直接编辑生成的文件，也可以不经命令手工创建同样的文件。`concord template list` 与 `concord template show feature` 查看随包模板。

## 关联真实测试

在测试文件中放置 `// @use-case docs/feature/login/use-case/expired-token.md`。`//`、`#` 与 `--` 都是标记前缀。Concord 从文件和标记派生执行引用，不需要人工 ID，也不解析宿主测试语法。

随后运行 `concord check`、`concord test list` 与 `concord show login`。回归测试另附 `@issue docs/issues/<issue>.md` 指向它守护的 Issue。这些测试关系只由源码标记拥有，反向列表由此派生。

## 配置并运行验证

`testRoots` 默认取存在的 `test/` 与 `tests/`，runner 默认用 Node 原生测试。纯文档仓库使用 `concord init --docs-only`，testRoots 为空；以后可以添加真实测试根。文档完整不等于测试覆盖。

`concord doctor` 检查配置与缺失的测试根，不执行仓库命令。使用其它 runner 时，把 runner 设为如下对象：

```json
{"kind":"command","argv":["your-runner","{file}"],"sourceFiles":[],"timeoutMs":60000}
```

每个占位符必须占据一个完整参数，支持 `{file}`、`{name}` 与 `{pattern}`，参数不经过 shell。附加的断言或 runner 配置文件放入 sourceFiles。Concord 不安装依赖。

只有 `test run`、`test verify` 与 `issue close --fixed` 执行 runner；check 在 `--since` 重放修复核验时执行，trace、template 与 doctor 都不运行测试。

## 修复缺陷

1. 把缺陷写成 Issue：`concord new issue <name>`，或直接创建 `docs/issues/<name>.md`。
2. 提交会失败的回归测试，附 `@issue` 标记；只提交测试，不改产品代码。
3. 单独提交修复，不改回归测试、runner 配置、`runner.sourceFiles` 与测试指向的 Spec。
4. 运行 `concord issue close <name> --fixed --reason <text>`：回归测试在缺陷提交上失败、在当前 HEAD 上通过时，结论写进 Issue（[证据的范围](feature/local-sdlc/scope.md#证据的范围)）。
5. `concord test verify <name>` 按记录重放。

完整路径与错误见[核验修复并关闭缺陷](feature/local-sdlc/use-case/resolve-with-command-evidence.md)。`concord review render` 生成本地审阅材料。

## 安全操作

`--dry-run` 预览 Concord 的写入，init 与 new 不覆盖已有文件。`--json` 输出机器可读结果。空仓库可以在没有测试时通过完整性检查。

发布中断使用 `concord recover`，可丢弃缓存损坏使用 `concord cache rebuild`。

## 工作项与知识

Memory 用 `concord memory index` 与 `concord memory recall` 检索，Issue 用 `concord issue recall` 与 `concord list --open` 检索。两者都直接编辑；`memory activate`、`memory supersede` 与 `issue close` 等命令写入同样的内容。见[检索与维护工程知识](feature/local-sdlc/use-case/recall-and-maintain-memory.md)。

Local、GitHub 与 Linear 统一作为反馈来源。本地 Issue 无需连接即可创建；远端接入只负责读取，本地状态由本地文件维护。见[本地观察](feature/feedback/use-case/manage-local-observations.md)。

## 目录作用域的术语与写作

术语由 docs 下的 `concepts.md` 拥有，写作政策由 `concord-writing.json` 拥有；两者可以直接编辑，也可以用 Concord concepts 与 writing 工具维护，结构、作用域与被引用的定义由 `check` 校验。目录拥有作用域：`docs/concepts.md` 保存全局定义，Feature 与 Engineering 子目录拥有各自的 `concepts.md` 与 `concord-writing.json`。每个二级标题 `## 写法 {#id}` 是一个概念，第一段是定义，之后是解释。

Web 工作台聚合这些来源而不复制。只有 frontmatter 中显式弃用的名称产生禁词，正文链接到 `concepts.md#id`。见[文件格式与作用域](feature/documentation-quality/policy.md)。
