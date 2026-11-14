# 初始化与模板

在目标 Git worktree 顶层执行；`init` 不把 Concord 的安装目录当接入项目，也不导入其它仓库的 worktree。

```sh
concord init
concord init --docs-only
concord init --test-root test --test-root e2e
concord init --runner-config ./concord-runner.json
concord doctor --json
```

`init` 创建固定布局、`AGENTS.md` 中的 Concord 受管区块，以及需要时的 `concord.config.ts`。配置可以不存在：

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `runner` | 无 | 需要 `test run` 或修复核验时 |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需 |

Memory 固定在 `memory/`。品味 `docs/taste.md` 存在即生效，没有状态字段。

`--docs-only` 适用于没有测试的文档仓库：生成 `testRoots: []`，不要求测试目录；不能与 `--test-root` 同用。以后有真实测试再配置 testRoots。文档检查通过不代表测试覆盖。

`--runner-config` 指向严格 JSON 文件。自定义 command runner 的 argv 不经过 shell，`{file}`、`{name}`、`{pattern}` 必须各占一个完整参数。`concord.config.ts` 是静态文件，可以直接编辑；`concord config show --json` 返回同一次读取的内容与 digest，`config set` 做整文件 CAS。

交互 `init` 在确认前展示最终配置及创建/保留清单；取消不写项目文件。仅无文档、无锁的新仓库预览不创建 Git-private 状态；已有仓库预览遵守未完成 journal 障碍，确认后在短期独占提交中重验。非 TTY 采用确定默认。init 生成的品味只有写法说明和示例；写入维护者确认过的条目后，它们就是现行规则。

`init` 一次创建分类目录、`docs/concord.md` 和缺失的 `docs/README.md`。它同时创建随包空 catalog `docs/concepts.md`、预设 `docs/writing.md`、`docs/architecture.md`、`docs/taste.md` 与 `docs/_template/`。

它先检查完整目标集，冲突时零写入失败；已有根文档、术语 catalog 和写作规则原样保留。`AGENTS.md` 只创建或刷新 Concord 受管区块，保留区块外内容。预览可用：

```sh
concord --dry-run init --test-root test
```

在未初始化的任意 cwd 也能读取随包模板：

```sh
concord template list --json
concord template show feature --title "登录"
```

模板只是写作提示，不是完成状态、测试执行或覆盖证明，也不带 frontmatter：路径是身份，一级标题是名称。初始化后先读 `docs/concord.md` 与 `docs/_template/README.md`，再用 `doctor --json` 查看缺失测试根和当前关联；`doctor` 不运行 runner。

模板中的图示提示保留 Mermaid，并允许用 p5 表达动态过程；不要为每篇文档自动添加动画。p5 核心随归档提供，扩展库按需在 `concord.config.ts` 的 `p5.libraries` 配置，初始化无需安装浏览器 CDN。运行 `concord --skill view` 获取内联、外部入口与项目配置示例。

init 的 AGENTS 托管区与 docs/concord.md 必须把 Agent 引到当前安装版本的 skill：Spec 声明目标，可复用经验归 Memory，待处理问题归 Issue，执行日志与进度留在任务交付中；全部文件可以直接编辑，提交前运行 `concord check`。检查生成指引时保留 AGENTS 托管区外内容。升级 Concord 不改写已有文档；运行 `concord --skill` 读取当前规则。

概念由全局或局部 concepts.md 拥有，唯一写法、定义和解释写在同一页；concepts 命令提供派生汇总。init 只在缺失时写入随包空 catalog，保留既有内容的全部字节。局部 writing.md 的目录决定 scope，不能用 roots 扩大局部范围。init 不从既有文档猜测概念定义或弃用词。

写作预设限制句长 140、段长 320，包含通用禁用表达，并开启未使用概念检查。局部目录继承祖先规则，仅在需要调整时创建政策。
