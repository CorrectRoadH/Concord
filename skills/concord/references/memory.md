# 工程 Memory

Memory 保存可复用的 Problem、Decision 与 Insight，不复制契约正文或测试关系。

```sh
concord memory add expired-token-accepted --kind problem --title "过期令牌被接受" --body ./problem.md
concord memory add token-format --kind decision --title "令牌格式" --body -
concord memory list --json
concord memory search "expired token" --json
concord memory show expired-token-accepted --json
```

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

`reopen` 会递增 Problem epoch，旧收据不能关闭新轮次。Decision / Insight 可被同 kind 的 Memory 替代，且不得形成循环：

```sh
concord memory reopen expired-token-accepted --reason "问题再次出现"
concord memory supersede token-format --replacement token-format-v2 --reason "采用新格式"
```

promotion 只指向有效当前契约；退役保留历史：

```sh
concord memory promote token-format-v2 --target docs/feature/login/README.md
concord memory retire token-format-v2 --target docs/feature/login/README.md --reason "目标已替换"
```

新 clone 缺少 Git-private evidence 时，历史 resolution 仍可读，但必须保留 evidence unavailable 的事实。
