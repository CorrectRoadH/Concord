# Repository profile 边界

`concord repo ...` 使用消费仓库的原生 E2E 工作流。通用 `concord test run` 记录 command evidence，不能替代正式 red/green/takeover 证据。先阅读消费仓库的测试契约。

## 入口

消费仓库的 `concord.repository.json` 指向自己的可信 host。host 拥有 candidate、Testkit、native inventory 和 takeover；Concord 校验 Git 顶层、host root 与锁定 engine 的实际字节。`RepositoryEngineMismatch` 时使用项目锁定入口。

```sh
pnpm exec concord --skill repository
pnpm run repo --help
pnpm run repo docs test --help
```

## 用路径关联测试

在真实顶层测试声明正上方放置一个契约注释：

```ts
// @use-case docs/feature/inspection/use-case/query-run.md
test("query run 经 pipe 交付完整文档", async () => {})
```

指向整个 Feature 时改用 `// @feature docs/feature/inspection/README.md`。目标必须存在且类型匹配；多个测试可以指向同一契约。无需人工 ID、标题后缀、testing owner 或 attach 步骤。

Concord 从 native 文件路径、声明文件路径和测试名称自动派生执行引用。helper 声明通过 `// @test-file e2e/<repo>/test/<entry>.test.ts` 指定 native 文件。名称或路径变化会改变执行引用；静态声明必须能与原生收集结果唯一对应。用 list 的结果选择测试，不手写引用。

```sh
pnpm run repo docs test list --json
pnpm run repo docs test inventory --repo <repo-id> --json
pnpm run repo docs test show <selector> --json
pnpm run repo docs test audit --json
```

`@regression` 指向 Problem Memory，`@issue` 保存经验证的 Issue 数据。维护这些关系使用 `regression`、`issue` 子命令；不手写证据或外部 provenance。current 关系只在源码注释中，反向关系由工具派生。`e2e/concord-history.ts` 仅保存历史和退役记录。

## 原生证据

host 声明 `caseIdentity: "concord.case-contracts/v1"`，并在实际执行副本中用相同算法唯一绑定 native case。字段声明本身不证明绑定正确；实现摘要必须覆盖绑定算法。AST 扫描不证明测试执行。

```sh
pnpm e2e evidence red --help
pnpm e2e takeover --help
pnpm run repo docs test regression add --help
pnpm run repo docs test regression refresh --help
pnpm memory resolve --help
```

正式证据绑定 `concord.repository-source-identity/v3`，其中 `direct-contract` 保存契约路径及内容摘要。源码投影使用 `concord.repository-source-projection/v2`：剥除真实关系注释，保留名称、测试逻辑与 native 文件映射。契约、helper 断言或源码路径变化会使证据陈旧。

新 fixed 需要完整正式 gate；旧 receipts 保留原件，不能补写摘要来冒充当前证据。更新已有 regression 的陈旧 proof 时，对 open Problem 使用 `regression refresh --reason` 并提供新受管 red、takeover 和 inventory。

## 冲突与恢复

`InventoryStale` 时重新收集，不修补 digest。遇到 journal 时保留现场，查看 `pnpm run repo docs trace recover --help` 并使用显式恢复。不要覆盖外部编辑。
