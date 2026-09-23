# 工程 Memory

Memory 保存 Problem、Decision、Insight 与未分类 Note，不复制契约正文或测试关系。唯一当前格式是 `concord.document/v1`，旧文件需要一次性迁移。

索引、检索和正文读取使用 `concord memory index --json`、`concord memory recall "查询词" --json`。recall 返回匹配的实际正文与摘要，是本地文本检索，不调用模型。不要直接读取或编辑 Memory 文件，不维护人工 INDEX。需要查看状态与关系仍可使用 show；index/list 与 recall/search 都从当前 owner 派生。

修改正文用 `concord memory edit <id-or-path> --body <file> --expected-digest <digest>`，或已有 `author set`。先从工具取得最新摘要，冲突后重新读取并核对，不盲目重试。正文更新不改状态、证据和历史；这些事实必须通过下述生命周期命令修改。受管文件以外的临时正文文件或 stdin 可以作为命令输入。

`captured` 表示已保存但尚未确认当前生命周期；它不允许 fixed 或 promotion。已分类记录通过 `concord memory activate <id> --reason <text>` 激活：Problem 变为 open，Decision／Insight 变为 current。Note 使用 `memory add --kind note` 创建，保持 captured。

```sh
concord memory add expired-token-accepted --kind problem --title "过期令牌被接受" --body ./problem.md
concord memory add token-format --kind decision --title "令牌格式" --body -
concord memory list --json
concord memory search "expired token" --json
concord memory show expired-token-accepted --json
```

配置可声明多个 worktree 内 `local-files` 来源。短 ID 在跨来源重复时拒绝并要求 canonical path；省略 `--source` 写唯一 `defaultWrite` 来源，显式写入用 `--source <name>`。read-only 权限在统一发布入口执行，包括 Roadmap adoption 的间接 promotion 改写。

fixed 必须绑定同一 active regression、当前 Problem epoch、相同测试定义与目标契约的 red/green command evidence，并提供实际修复理由：

```sh
concord memory resolve expired-token-accepted --kind fixed \
  --red ccev_REPLACE_WITH_RED_ID --green ccev_REPLACE_WITH_GREEN_ID \
  --reason "修正校验后拒绝过期令牌"
```

作者裁决不用 command evidence：

```sh
concord memory resolve expired-token-accepted --kind not-a-bug --reason "行为符合当前契约"
concord memory resolve expired-token-accepted --kind wont-fix --reason "风险已接受"
concord memory resolve expired-token-accepted --kind external-fixed --reason "上游版本已修复"
```

`reopen` 会递增 Problem epoch，旧收据不能关闭新轮次。Problem、Decision、Insight 可被同 kind 的 Memory 替代，且不得形成循环。superseded 表示不再适用，不能据此称为 fixed；原 resolution 与 promotion 保留在历史：

```sh
concord memory reopen expired-token-accepted --reason "问题再次出现"
concord memory supersede token-format --replacement token-format-v2 --reason "采用新格式"
```

promotion 只指向有效当前契约；退役保留历史：

```sh
concord memory promote token-format-v2 --target docs/feature/login/README.md
concord memory retire token-format-v2 --target docs/feature/login/README.md --reason "目标已替换"
```

迁移保留的原处理声明使用 `attested`，显示未验证。Profile 严格正式 gate 写入 `repository` 证据；通用入口显示其记录事实与 unavailable，不将它当作 command 证据。新 clone 缺少 Git-private evidence 时，历史 resolution 仍可读，但必须保留 evidence unavailable 的事实。
