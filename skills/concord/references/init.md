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

`init` 一次创建配置、分类目录、`docs/concord.md`、缺失的 `docs/README.md`、`docs/concepts.md`、`docs/architecture.md` 与 `docs/_template/`。它先检查完整目标集，冲突时零写入失败，保留上述已有根文档，不修改 `AGENTS.md`。预览可用：

```sh
concord --dry-run init --test-root test
```

在未初始化的任意 cwd 也能读取随包模板：

```sh
concord template list --json
concord template show feature --title "登录"
```

模板只是写作提示，不是完成状态、测试执行或覆盖证明。初始化后先读 `docs/concord.md` 与 `docs/_template/README.md`，再用 `doctor --json` 查看缺失测试根和当前关联；`doctor` 不运行 runner。
