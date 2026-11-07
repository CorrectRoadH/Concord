---
relations:
  - role: spec
    target: docs/feature/local-sdlc/cli.md
---

# adapter 调用失败时错误里没有调用的退出状态与输出

## 现象

NiceEval 用外部 adapter 运行 `concord test discover`，125 秒后以 `CollectFailed: A native collection invocation did not exit normally with code 0` 结束。错误里没有这次 Invocation 的退出码、信号与输出：安装后的 `executePlan` 在 Invocation 非零退出后直接丢弃结果，返回通用错误（安装产物 `dist/domain/tests/test-adapters.js:175`）。使用者无法从公开输出得知失败原因。

## 期望

按 [adapter 协议](../feature/local-sdlc/cli.md#adapter-协议)：失败时 `details.invocations` 给出每个 Invocation 的退出码、信号、超时、取消、截断、清理状态，以及 stdout、stderr 末尾最多 64 KiB。先写失败回归，再按 `--fixed` 修复。
