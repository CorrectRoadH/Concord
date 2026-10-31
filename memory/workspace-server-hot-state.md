---
type: decision
status: current
relations:
  - role: supports
    target: docs/feature/local-data-engine/architecture.md
---

# 工作区服务保留进程边界，从内存提供热状态

日期 2026-10-30。细化 [CLI 热路径](../docs/design/cli-hot-path/DECISION.md)选定的工作区服务，不改变其进程模型。

## 证据

参照机器上对本仓库运行 f4bd3ce 构建的 `concord --json trace check`，CPU profile 2.77 s。HawDB `Database.scan` 704 ms，打开与产物校验 143 ms，Markdown 解析约 350 ms，路径安全 `lstat` 137 ms，Schema 解码约 150 ms，模块加载约 150 ms，读文件与 sha256 约 60 ms。读取与摘要不是主要成本，每个进程重新打开、扫描持久库并重新解析才是。

## 决定

- 主进程在内存中保持已接受的代次；订阅与工作区读取从内存返回，接受代次时仍写入持久行。
- 服务的每个应用操作只定义一次，RPC 与 HTTP 是适配层，见[服务操作](../docs/architecture.md#服务操作)。
- 服务的状态机与计时在测试进程内用 Layer 加 TestClock 验证，跨进程行为用真实进程验证。
- 性能预算默认在没有服务时测量，经由服务的场景声明服务条件。

## 否决的方案

曾提出把服务改成单进程：计算放进 worker thread、写入在线程中执行、取消持久代次。原生 Codex 独立审查结论为 REVISE，理由有三。

1. publication lease 以进程 PID 判定 owner 存活。线程被终止而服务进程仍活着时，新线程与 `concord recover` 都无法回收 lease 与 journal。
2. `Worker.terminate()` 只停止 JavaScript。它不收拢固定版本 TypeScript 同步 API 启动的编译器子进程，也不运行线程内 Scope 的 finalizer。
3. `workspace projection --json` 在没有服务时读取持久行，刷新失败时继续展示上一代；取消持久代次会改变这项公开行为。

若将来要减少计算进程的开销，只替换不持有发布能力、不启动子进程的纯计算部分，并先测量。
