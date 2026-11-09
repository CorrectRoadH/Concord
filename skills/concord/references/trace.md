# 检查、追踪与审阅

Concord 从 Spec、源码与测试标记、Issue 和 Memory 的 frontmatter 动态编译关系，不维护反向 registry。

```sh
concord check --json
concord docs check docs/feature/login --json
concord trace check --json
concord trace gaps [login] --json
concord trace show docs/feature/login/README.md --json
concord trace show docs/feature/login/use-case/expired-token.md#reject-token --json
concord review docs/feature/login/README.md
concord review
```

`check` 与 `trace check` 校验当前文件的放置、引用、重复、循环、概念、写作与修复核验记录，不执行测试。`docs check [<path>...]` 只对所选文件或目录执行写作与术语检查，供单篇或单 Feature 编辑时快速反馈。fixed 的 Issue 缺少 `verification`、记录的提交不存在或测试不再指向该 Issue 时，`check` 报告 finding。`show` 与 `trace show` 接受 canonical path、短选择器或 `<path>#<anchor>`；传入 `<path>#<anchor>` 时先校验该步骤或标题 anchor 存在，再只返回直接指向它的测试、代码声明与 incoming 关系。

`trace gaps [<feature-or-path>]` 列出没有显式 code/test 关系的 Feature、Use Case，以及没有直接关系的已建档 `docs/feature/*/cli.md`；传入 Feature、Use Case 或 Engineering 的路径或短选择器时只输出该目标范围内的缺口。Feature 汇总子 Use Case，CLI 页面则要求关系直接指向页面或 anchor。结果不是覆盖率，也无法发现从未建档的命令；这类 inventory 仍由产品拥有。

`review` 只生成本地 Markdown 审阅材料，不写 GitHub、不发送消息。交接时报告实际修改、运行过的验证、具名 finding，以及仍需授权的提交、push、发版或部署。

不要把“无 finding”、命令成功或审阅材料表述成完整覆盖、native case passed 或原生 E2E 可靠性证明。

## Diagnostic freshness

`trace show`, `trace gaps` and `review` read completed historical projections and request background refresh. Their output includes the snapshot time and refresh status.

With no projection yet, the first run waits for the background refresh and prints the projection it publishes; `QueryPending` means that refresh failed or timed out. Use `--fresh` to wait for current sources. Use `check` or `trace check` for current validation. Historical projections cannot authorize writes or fix verification.
