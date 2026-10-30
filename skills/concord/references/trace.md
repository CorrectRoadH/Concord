# 检查、追踪与审阅

Concord 从 Spec、源码与测试标记、Issue 和 Memory 的 frontmatter 动态编译关系，不维护反向 registry。

```sh
concord check --json
concord trace check --json
concord trace gaps --json
concord trace show docs/feature/login/README.md --json
concord review render docs/feature/login/README.md
concord review render
```

`check` 与 `trace check` 校验当前文件的放置、引用、重复、循环、概念、写作与修复核验记录，不执行测试。fixed 的 Issue 缺少 `verification`、记录的提交不存在或测试不再指向该 Issue 时，`check` 报告 finding。`trace show` 接受 canonical path / anchor，也可按当前 CLI 支持的引用形式定位；它保留 supporting page 的精确 path/anchor，并动态反查测试与 Memory。

`trace gaps` 列出没有显式 code/test 关系的 Feature、Use Case，以及没有直接关系的已建档 `docs/feature/*/cli.md`。Feature 汇总子 Use Case，CLI 页面则要求关系直接指向页面或 anchor。结果不是覆盖率，也无法发现从未建档的命令；这类 inventory 仍由产品拥有。

`review render` 只生成本地 Markdown 审阅材料，不写 GitHub、不发送消息。交接时报告实际修改、运行过的验证、具名 finding，以及仍需授权的提交、push、发布或部署。

不要把“无 finding”、命令成功或审阅材料表述成完整覆盖、native case passed 或原生 E2E 可靠性证明。

## 差异门禁

`concord check --since <base>` 在当前检查之外，对照基线提交检查本次变化。直接编辑的可信度由它保证，CI 对每个变更运行它：

| 变化 | 检查 |
| --- | --- |
| Issue 新增或修改 fixed 的 `verification` | 按记录重放修复核验，失败或无法重放即报告 |
| Issue、Memory 的状态改变 | 转换合法，例如 note 不能成为 current，closed 必须带完整的关闭结论 |
| active 宪法的条款或款改变 | 本次变化中有一条 `type: decision` 的 Memory 以 `amends` 指向它们 |
| DECISION 的 `Selected:` 改变 | 按 `design decide` 的规则校验全部候选与 Limits |
| Roadmap 移入 `docs/feature/` | 链接改写与采用规则满足 |

只在本地运行 `check` 时不重放修复核验；提交前对目标分支运行一次 `check --since`。

## Diagnostic freshness

`trace show`, `trace gaps` and `review render` read completed historical projections and request background refresh. Their output includes the snapshot time and refresh status. A cold cache reports `QueryPending`; use `--fresh` to wait for current sources. Use `check` or `trace check` for current validation. Historical projections cannot authorize writes or fix verification.
