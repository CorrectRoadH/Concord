---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 并行启动的命令期服务以 SocketOpenError 失败

## 现象

NiceEval 的 repo-tools 测试在并行的 Vitest 中，对隔离 fixture 运行 `concord --root <fixture> --json --server command test list`，退出 1：`OperationFailed`，message 为 `SocketOpenError: timeout waiting for "open"`（`/tmp/concord-closure/repotools-cli-failures.jsonl`）。同一 fixture 单独运行成功。发生时本机负载很高。

## 期望

按[服务启动](../feature/local-data-engine/architecture.md#工作区服务)：启动者最多等 10 秒让自己拉起的服务完成握手，超时报 `WorkspaceServerUnavailable` 并以非零码退出，不把底层 socket 错误作为 `OperationFailed` 透出。先写并行启动多个命令期服务、并让 socket 打开超过客户端时限的失败回归，确认 socket 打开的等待计入这 10 秒，再按 `--fixed` 修复。负载下是否仍会超时，在空闲环境（CI）复跑后再判断。
