# Repository profile 边界

`concord repo ...` 保留消费仓库的文档、Memory 与原生 E2E 工作流。通用 `concord test run` 记录 command evidence；它不能替代此 profile 的正式 red/green/takeover 证据。先读消费仓库规则和测试契约。

## 入口与安装

消费仓库的 `concord.repository.json` 指向自己的 host。host 拥有真实 candidate、Testkit、native inventory 和 takeover。Concord 校验 Git 顶层、host root、协议与锁定 engine 的实际字节；`RepositoryEngineMismatch` 时使用项目入口，不绕过校验。

NiceEval 使用签入仓库的已构建 tarball 和锁定依赖：

```sh
pnpm install --frozen-lockfile
pnpm exec concord --skill repository
pnpm run repo --help
pnpm run repo docs test --help
pnpm memory --help
```

离线安装还需要其它依赖的本地缓存。Concord 自身开发可以全局 link checkout 后 `pnpm build`；这个 link 不替代另一个仓库锁定的包。

## 当前关系写在声明上方

```ts
// @concord-case necase_7J4M2N6Q8R3T5V9X
// @concord-owner docs/engineering/testing/e2e/inspection.md#inspection-query
// @concord-regression memory/query-run-pipe-truncated-at-128k.md
test("query run 经 pipe 交付完整文档 [necase_7J4M2N6Q8R3T5V9X]", async () => {})
```

ID 是永久不复用的 opaque 身份，title 末尾仍须有同一 token。每 case 一个 testing owner，owner authority 再唯一指向 Feature 或 Use Case。不要在此 profile 改用通用模式的 `@concord-contract`。

helper 声明用 `// @concord-test-file e2e/<repo>/test/<entry>.test.ts` 明示 native owner path；selector 是 `<native-path>#<caseId>`，旧路径不会自动跟随。可重复的 `@concord-issue` 保存经验证的严格 JSON Issue 数据；不用手写外部 provenance。

AST 只定位注释和声明；只有原生 runner collection 产生 inventory。歧义、重复、动态展开和无效注释必须先修正。当前关系不另写 `.cases.json`；`e2e/concord-history.ts` 只保存 history/tombstone 注释，不保存 current 副本。证据索引和旧 receipts 仍然是独立证据文件。

## 新增与维护 case

从现有产品契约和 testing owner 开始，优先加强同一长期结果的既有 case。按实际子命令帮助核对参数：

```sh
pnpm run repo docs test list --json
pnpm run repo docs test case allocate-id --json
pnpm run repo docs test inventory --repo <repo-id> --json
pnpm run repo docs test owner create --help
pnpm run repo docs test case attach <path#caseId> --owner <owner-ref> --inventory <neinv-id> --json
pnpm run repo docs test show <path#caseId> --json
pnpm run repo docs test case move --help
pnpm run repo docs test case retire --help
pnpm run repo docs test issue add --help
pnpm run repo docs test audit --json
```

把新分配的 ID 放到真实可见标题后，再 collection 并 attach。用具名命令维护关系、移动和退役，保留事务历史及 ID。多 case 文件逐 case 操作，不把一个文件的关系复制给全部测试。`audit` 的 uncoveredUseCases、unassignedCases、missingRelations、orphanedRelations 是不同发现。

## 正式回归与证据更新

先取得旧 candidate 的公开入口 red，再验证修复 candidate 的 green 与可靠性矩阵；不能用私有函数调用、手写 receipt 或 diagnose 代替。

```sh
pnpm e2e evidence red --help
pnpm e2e takeover --help
pnpm run repo docs test regression add --help
pnpm run repo docs test regression refresh --help
pnpm memory resolve --help
```

root runner 返回 `nered_...` / `netake_...`，inventory 返回 `neinv_...`。`regression add` 使用这些受管 ID；不传任意 JSON 或 artifact 路径。新 fixed 只接受 v2 formal evidence：绑定同一固定执行副本的源码投影、case/native path、owner/contract 引用和完整 Markdown 内容。源码投影剥除经过严格解析的真实受管注释；字符串里的假注释、普通代码、helper 与路径集合变化仍会使 proof 失效。它不证明完整依赖闭包。

旧 v1 receipts、证据索引与 fixed Memory 保留为历史并显示 legacy/stale/unavailable，不自动 reopen。已有 current regression 的 proof 需要更新时，对 open Problem 使用 `regression refresh --reason <text>`，附带新的 red/takeover/inventory。刷新原子归档旧索引指针，不重写旧 receipts，也不追加重复 regression。有效 current v2 proof 的重复刷新会拒绝。

## 冲突与恢复

`InventoryStale` 或 bundle identity 变化：用当前工具重新 collection/运行；不修补 digest。`CasePathStale`：读取当前 selector 并核对迁移。遇到 journal 时保留现场，查看 `pnpm run repo docs trace recover --help` 后执行显式恢复。不要覆盖外部编辑。
