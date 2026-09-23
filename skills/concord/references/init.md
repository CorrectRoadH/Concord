# 初始化与模板

在目标 Git worktree 顶层执行；`init` 不把 Concord 的安装目录当消费仓库，也不导入外部 checkout。

```sh
concord init
concord init --docs-only
concord init --test-root test --test-root e2e
concord init --runner-config ./concord-runner.json
concord init --project-type library --project-type cli --design
concord init --no-default-pages
concord doctor --json
```

`--docs-only` 适用于没有测试的文档仓库：生成 `testRoots: []`，不要求测试目录；不能与 `--test-root` 同用。以后有真实测试再配置 testRoots。文档检查通过不代表测试覆盖。

`--runner-config` 指向严格 JSON 文件。默认 runner 是 Node 原生测试；自定义 command runner 的 argv 不经过 shell，`{file}`、`{name}`、`{pattern}` 必须各占一个完整参数。新项目生成静态 `concord.config.ts`；先用 `concord config show --json` 取得同一次读取的 digest，再通过 `config set` 做整文件 CAS。普通运行时仅接受 `concord.config.ts`；检测到旧 `concord.json`（包括双配置）返回 `ProjectMigrationRequired`，须先显式离线迁移。

交互 `init` 渐进选择项目类型、根 `DESIGN.md`、默认页面和本地 Memory 来源，在确认前展示最终配置及创建/保留清单；取消不写项目文件。仅无 owner、无锁的新仓库预览不创建 Git-private 状态；已有仓库预览遵守共享 lease 和两套 journal 障碍，确认后取得独占锁重验。非 TTY 采用确定默认。`docs/constitution.md` 必需，默认是明确 draft；只有提供真实条款、理由和影响并显式采用才是 active。

`init` 一次创建配置、分类目录、`docs/concord.md`、缺失的 `docs/README.md`、`docs/concepts.md`、空 `docs/concepts.json`、`docs/architecture.md` 与 `docs/_template/`。它先检查完整目标集，冲突时零写入失败；已有根文档和概念 JSON 原样保留。`AGENTS.md` 只创建或刷新 Concord 受管区块，保留区块外内容。预览可用：

```sh
concord --dry-run init --test-root test
```

在未初始化的任意 cwd 也能读取随包模板：

```sh
concord template list --json
concord template show feature --title "登录"
```

模板只是写作提示，不是完成状态、测试执行或覆盖证明。初始化后先读 `docs/concord.md` 与 `docs/_template/README.md`，再用 `doctor --json` 查看缺失测试根和当前关联；`doctor` 不运行 runner。

init 的 AGENTS 托管区与 docs/concord.md 必须把 Agent 引到当前安装版本的 skill：契约声明目标，开发过程与经验归 Memory，观察归 Issue；Memory/Issue 通过 Concord 工具索引、recall、读取和修改，禁止手工维护 owner 文件或 INDEX。检查生成指引时保留 AGENTS 托管区外内容。已有项目不会因升级安装包自动改写历史文档；运行 `concord --skill` 读取当前规则。

概念的结构化定义使用全局或局部 concepts.json，解释和案例保留在 Markdown；concepts 工具提供派生汇总。局部 concord-writing.json 的目录决定 scope，不能用 roots 扩大局部范围。旧 writing/v1 须显式迁移，init 不从历史概念表猜测定义或弃用词。
