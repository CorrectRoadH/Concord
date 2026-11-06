# 并行切分文档工作

## 用户目标

父 Agent 在多人共享的 worktree 上，把已定稿的文档目标切成互斥写集交给不同 Agent，并用可重新执行的检查收据验收每份交付，最后由一个 finalizer 收尾。

## 起始状态

- 项目已初始化，`docs/feature/cart/` 与 `docs/feature/search/` 已提交；search 的改写要参考 cart 的新 README。
- 项目可在 `concord.config.ts` 的 `docsWork` 中声明检查命令、finalizer 与共享路径，见 [Docs Work 配置](../cli.md#docs-work-配置)；本例不声明，使用内建检查 `writing` 与内建 finalizer `concord check`。
- 命令、计划格式与收据字段见 [CLI](../cli.md#docs-work)。

## 完整路径

1. 写计划并准备 run。 {#prepare}

   `plan.json`：

   ```json
   {"format":"concord.docs-work-plan/v1","items":[
    {"id":"cart","goal":"Rewrite cart README","write":["docs/feature/cart/"]},
    {"id":"search","goal":"Rewrite search README","write":["docs/feature/search/"],"read":["docs/feature/cart/README.md"],"blockedBy":["cart"]}]}
   ```

   ```sh
   concord docs work prepare --plan plan.json --run-id demo
   ```

   输出（节选）：

   ```json
   {
     "operation": "docs-work-prepare",
     "runId": "demo",
     "baseCommit": "0835ea283a24a19fdea358aac75c05bf3ba77bb4",
     "configDigest": "sha256:e4ee016d…",
     "items": [
       { "id": "cart", "goal": "Rewrite cart README", "write": ["docs/feature/cart/"], "read": [], "blockedBy": [], "checks": ["writing"] },
       { "id": "search", "goal": "Rewrite search README", "write": ["docs/feature/search/"], "read": ["docs/feature/cart/README.md"], "blockedBy": ["cart"], "checks": ["writing"] }
     ],
     "statePath": "/home/me/shop/.git/concord/docs-work/v1/demo"
   }
   ```

   只切单个目录时用 `--scope <path>` 代替 `--plan`。prepare 只要求声明的 read、write 与共享路径干净，其它位置的改动不影响它。

2. 把 item 交给 Agent，Agent 完成后自报。 {#report}

   ```sh
   concord docs work check demo cart --report
   ```

   输出（节选）：

   ```json
   {
     "operation": "docs-work-check",
     "receipt": {
       "itemId": "cart",
       "changedPaths": ["docs/feature/cart/README.md"],
       "status": "reported",
       "checks": [{ "id": "writing", "status": "passed", "exitCode": 0, "outputDigest": "sha256:38ab5502…", "summary": "{\"ok\":true,\"findings\":[]}" }]
     },
     "receiptDigest": "sha256:c6f1f804…"
   }
   ```

   Agent 把 `receiptDigest` 交给父 Agent。

3. 父 Agent 核对 diff，再重跑检查。 {#verify}

   ```sh
   concord docs work check demo cart --verify sha256:c6f1f804…
   ```

   收据变为 `"status": "verified"`，`reportedReceipt` 指向第 2 步的收据。被依赖的 item 必须先 verified：cart 未 verified 时核验 search 得到：

   ```json
   {"ok":false,"error":"DocsWorkDependencyUnverified","message":"Dependency cart is not verified"}
   ```

   search verified 后，收据的 `dependencies` 记录 cart 当时的 verified 收据 digest。

4. 全部 item verified 后收尾。 {#finalize}

   ```sh
   concord docs work finalize demo
   ```

   输出（节选）：

   ```json
   {
     "operation": "docs-work-finalize",
     "status": "finalized",
     "finalizer": { "exitCode": 0, "outputDigest": "sha256:c78b1eb6…", "summary": "{\"operation\":\"check\",\"ok\":true,…}" }
   }
   ```

   还有 item 没有 verified 时返回 `"status": "blocked"` 并按 item 列出原因，例如 `{"itemId":"cart","reason":"Verified receipt is missing or failed"}`，退出 1。

## 结果

| 情形 | 结果 |
| --- | --- |
| scope 外有脏文件 | 不阻止 prepare |
| write 重叠、命中共享路径、路径不安全或依赖未声明 | prepare 聚合全部问题返回 `DocsWorkPlanInvalid`，零写入，见[规划校验](../cli.md#规划校验) |
| 目录 write 中新建了文件 | 计入 writeDigest |
| 检查失败 | 收据标记 failed，退出 1 |
| read 或共享路径在 prepare 后变化 | `DocsWorkReadChanged`，不写收据 |
| 项目配置在 prepare 后变化 | `DocsWorkConfigChanged`，不运行检查 |
| 依赖未 verified | `DocsWorkDependencyUnverified` |
| `--verify` 的 digest 与当前 reported 收据不符 | `DocsWorkReceiptMismatch` |
| B 依赖 A 且已 verified，之后 A 重新 verified | finalize 返回 blocked，要求 B 重新 verified |
| 已 finalized 后再次 finalize | `DocsWorkFinalized`，退出 1 |
| 写入了任何 item 都未声明的路径 | 不报告，由父 Agent 的 diff 验收负责，见[证明范围](../cli.md#证明范围) |

### 验收方式

在打包后公开 CLI 与隔离 Git 消费者中验证上表各情形。
