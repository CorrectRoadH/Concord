# 修改品味却没有记下理由

## 用户目标

维护者改了一条品味，但忘了写理由；项目希望这样的修改在合并前被拦下。

## 起始状态

- `docs/taste.md` 中有 `T-1`。

## 完整路径

1. 直接编辑 T-1 的正文，不写 Decision Memory。

2. 检查本次变化。

   ```sh
   concord --json check --since master
   ```

   预期输出，退出 1：

   ```json
   {"operation":"check","ok":false,"complete":true,"findings":[{"code":"TasteChangeUnrecorded","path":"docs/taste.md","line":9,"message":"T-1 changed without a decision Memory that changes docs/taste.md#t-1","category":"relation"}]}
   ```

3. 补一条以 `changes` 指向 `docs/taste.md#t-1` 的 Decision Memory，再检查。

   预期输出以 `ok: true` 开头，退出 0。

## 结果

每次修改条目都有一条可检索的理由。CI 对每个变化运行 `check --since`，没有理由的修改不能合并。

## Spec 来源

- [命令](../cli.md#错误与-finding)
