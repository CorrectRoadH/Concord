# 高级测试治理

`concord repo` 使用消费仓库声明的套件与原生能力；`concord test run` 只签发 command evidence，不能替代已采用的可靠原生证据要求。

## 接入

在 Git worktree 根声明 `concord.repository/v2` 配置：`suites: [{id, root}]`、显式 `historyPath`、`policy: "concord.native-reliability/v1"` 及可选 `host`。目录安全、不重叠，不要求 Nx 或产品专属布局。host 只有在显式请求其能力时加载，静态查询不会运行它。

```sh
concord repo --help
concord repo docs test list --json
concord repo docs test inventory --repo <suite-id> --json
concord repo docs test show <selector> --json
concord repo docs test audit --json
```

## 声明与执行

真实顶层测试旁使用 `@feature` 或 `@use-case` canonical 契约引用，helper 使用 `@test-file tests/acceptance/entry.test.ts`。身份从 native 文件、声明文件和静态名称派生，不手填 ID。current 关系只由源码拥有，反向列表派生；历史归档只保存历史与退役事实。

原生 inventory 必须唯一绑定当前声明。AST、关系或命令成功均不代表 native case 通过。adapter 负责真实执行及资源终结；Concord 核验当前源码、契约、配置、policy、实现身份、候选和 invocation。

## 回归与可靠性

```sh
concord repo docs test regression add --help
concord repo docs test regression refresh --help
concord repo memory resolve --help
```

由项目自己的原生执行入口取得受管 red、完整可靠性观察和 inventory，再通过 regression add/refresh 登记。协议要求单项 green、三份隔离副本、同副本两次、默认并行与全部 cleanup；不得手写通过收据。已有 regression 的陈旧证明通过 `refresh --reason` 更新，旧原件保留。

Problem 已采用的最低要求不能通过 command 入口或删除配置降级。reopen 后须按新 epoch 重新取证，旧 invocation 不复用。red 的缺陷候选可以与 green 不同，green 和六次可靠性观察必须对应同一修复候选。

遇到 stale、缺失能力、绑定歧义或清理失败时处理具体原因，不补摘要绕过。旧配置和旧事务使用显式离线迁移；普通恢复查看 `concord repo docs trace recover --help`，保留未知编辑和未完成现场。
