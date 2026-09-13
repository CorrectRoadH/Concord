# 初始化与模板

在目标 Git worktree 顶层执行；`init` 不把 Concord 的安装目录当消费仓库，也不导入外部 checkout。

```sh
concord init
concord init --docs-only
concord init --test-root test --test-root e2e
concord init --runner-config ./concord-runner.json
concord doctor --json
```

`--docs-only` 适用于没有测试的文档仓库：生成 `testRoots: []`，不要求测试目录；不能与 `--test-root` 同用。以后有真实测试再配置 testRoots。文档检查通过不代表测试覆盖。

`--runner-config` 指向严格 JSON 文件。默认 runner 是 Node 原生测试；自定义 command runner 的 argv 不经过 shell，`{file}`、`{name}`、`{pattern}` 必须各占一个完整参数。已有仓库也可直接维护生成的 `concord.json`。

`init` 一次创建配置、分类目录、`docs/concord.md`、缺失的 `docs/README.md` 与 `docs/_template/`。它先检查完整目标集，冲突时零写入失败，不修改已有 `docs/README.md` 或 `AGENTS.md`。预览可用：

```sh
concord --dry-run init --test-root test
```

在未初始化的任意 cwd 也能读取随包模板：

```sh
concord template list --json
concord template show feature --title "登录"
```

模板只是写作提示，不是完成状态、测试执行或覆盖证明。初始化后先读 `docs/concord.md` 与 `docs/_template/README.md`，再用 `doctor --json` 查看缺失测试根和当前关联；`doctor` 不运行 runner。
