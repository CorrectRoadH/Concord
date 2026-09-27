# 使用 Concord 开发

Concord 连接当前产品契约、真实测试声明与工程记忆。

先运行 `concord --skill` 读取短入口，再按任务运行 `concord --skill <topic>`；完整离线资料使用 `concord --skill all`。

## 本仓库的自举用法

Concord 用当前 checkout 构建并 link 的公开 CLI 维护自身契约，入口报告的版本与 `package.json` 一致。项目 runner 为：

```text
node --import tsx --test --test-name-pattern {pattern} {file}
```

维护文档前阅读[本地 SDLC 闭环](feature/local-sdlc/README.md)与 [Concord 自举维护](engineering/concord-self-hosting/README.md)。

新增或调整测试时，在测试文件里放置 `@feature <canonical path>` 或 `@use-case <canonical path>`，可附加 `@regression` 和 `@status`。标记存在即构成关联，测试 ID 由文件和标记派生。测试回调通过 `Effect.runPromise` 执行 Effect program。

日常自举检查：

```text
concord doctor
concord check
concord test list
concord trace check
concord trace show local-sdlc
concord review render local-sdlc
```

`concord check` 汇总关系、生命周期和写作检查，均不执行 runner；只有显式 `concord test run <case-id>` 产生 command evidence。仓库质量门是 `pnpm check`。command evidence 不是正式 E2E，也不是逐测试覆盖证明；repository profile 的规则见[对应 Use Case](feature/local-sdlc/use-case/load-compatible-repository-profile.md)。

## 关联实现与契约

在 `concord.config.ts` 配置 sourceRoots，或用 `--source-root src` 初始化，选项可重复。运行 `concord --skill code` 查看文件、函数和语句区域声明。

`code annotate` 生成注释，`code locate <path> --line <n>` 查看全部包含范围，`trace show` 反查契约。代码声明描述实现关联，不表示完成或测试覆盖。

## 选择拥有意图的文档

- [Feature](feature/README.md)：已采用的产品契约，实现可以尚在追赶。
- [Roadmap](roadmap/README.md)：待采用的定稿方向。
- [Design](design/README.md)：目标、约束、自包含候选与裁决理由。
- [Engineering](engineering/README.md)：本仓库的测试与维护机制。
- [Research](research/README.md)：决策所需的外部事实与来源。
- [Memory](../memory/README.md)：Problem、Decision 与可复用经验及其历史。
- [Issue](issues/README.md)：待调查的本地观察。

`docs/` 只写声明：目标、行为、约束、使用方法与验收条件，产品流程属于契约。开发日志、排障经过与实施进度归 Memory，待调查观察归 Issue。模板提供写作提示，不代表需求完成或证据。

## 完整初始化

init 建立全部分类目录、文档入口和完整的[模板参考](_template/README.md)。

Feature、Roadmap 与每个 Design 候选必须有 README。用 `--pages library,cli,architecture,lifecycle,use-case` 或重复 `--pages` 选择可选页面；省略时使用项目默认，`--no-pages` 只创建 README。Design 裁决外层页面总是创建，Engineering 从 README 开始按主题扩展。

`page add` 添加可选或自定义专题页，添加后维护 README 中的链接。

## 项目宪法

规划、实施或审阅功能前阅读[宪法](constitution.md)。Feature 与 Design owner 通过 constitutionRefs 引用适用条款。

`concord constitution show` 查看正文、digest 与受影响 owner；adopt 与 amend 记录理由、来源和影响。draft 模板不表示合规。

## 第一个 Feature

```text
concord feature create login --title "Login"
concord use-case create expired-token --feature login --title "Reject expired tokens"
```

填写生成的作者正文。`concord template list` 与 `concord template show feature` 查看随包模板。

`--body <file>` 提供正文，`--body -` 读取 stdin。`page show` 返回当前 digest，`page set --expected-digest` 在替换页面前核对它。生命周期 metadata 由对应 Concord 命令拥有。

## 关联真实测试

在测试文件中放置 `// @use-case docs/feature/login/use-case/expired-token.md`。`//`、`#` 与 `--` 都是标记前缀。Concord 从文件和标记派生执行引用，不需要人工 ID 或 attach 步骤，也不解析宿主测试语法。

随后运行 `concord check`、`concord test list` 与 `concord trace show docs/feature/login/README.md`。测试保护已记录的 Problem 时使用 `--regression memory/<problem>.md`。这些测试关系只由源码标记拥有，反向列表由此派生。

## 配置并运行验证

`concord.config.ts` 拥有 testRoots 与 runner 配置，默认用 Node 原生测试扫描 test/ 与 tests/。纯文档仓库使用 `concord init --docs-only`，testRoots 为空；以后可以添加真实测试根。文档完整不等于测试覆盖。

`concord doctor` 检查配置与缺失的测试根，不执行仓库命令。使用其它 runner 时，把 runner 设为如下对象：

```json
{"kind":"command","argv":["your-runner","{file}"],"sourceFiles":[],"timeoutMs":60000}
```

每个占位符必须占据一个完整参数，支持 `{file}`、`{name}` 与 `{pattern}`，参数不经过 shell。附加的断言或 runner 配置文件放入 sourceFiles。Concord 不安装依赖。

只有 `concord test run <id>` 执行 runner，check、trace、template 与 doctor 都不运行测试。运行结果是 command evidence，不证明某个原生用例已执行或功能已覆盖。

修复 Problem 时先取得正常失败的 red，修改产品实现，再取得 green；两次运行之间保持测试定义和契约不变。用两份收据 ID 和明确理由关闭，见 `concord memory resolve --help`。`concord review render` 生成本地审阅材料。

## 安全操作

`--dry-run` 预览文档变更，init 与 create 不覆盖已有文件。`--json` 输出机器可读结果。空仓库可以在没有测试时通过完整性检查。

私有证据按 Git worktree 保存，普通 clone 不复制；缺失的证据显示为不可用。发布中断使用 `concord recover`，可丢弃缓存损坏使用 `concord cache rebuild`。

## 用工具维护工程知识

Memory 使用 `concord memory index` 与 `concord memory recall` 获取索引和正文，Issue 使用 `concord issue index` 与 `concord issue recall`。创建和修改使用 add、create、edit 或 author set，状态与关系使用具名生命周期命令。Agent 不直接读写受管 Memory 与 Issue 文件，不手工维护 INDEX.md 或关系登记表。见[工具式记忆维护](feature/local-sdlc/use-case/recall-and-maintain-memory.md)。

Local、GitHub 与 Linear 统一作为反馈来源。Local 无需连接即可用 `concord issue create` 创建观察；远端接入只负责读取，本地笔记和状态由本地工具维护。见[本地观察](feature/feedback/use-case/manage-local-observations.md)。

## 目录作用域的术语与写作

docs 下的结构化 JSON 用 Concord concepts 与 writing 工具维护。目录拥有作用域：`docs/concepts.json` 保存全局定义，Feature 与 Engineering 子目录拥有各自的 `concepts.json` 与 `concord-writing.json`。

Web 工作台聚合这些来源而不复制。Markdown 解释关系与示例，只有显式弃用的名称产生禁词。见[政策与迁移](feature/documentation-quality/policy.md)。
