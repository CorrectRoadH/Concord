---
relations:
  - role: spec
    target: docs/feature/local-data-engine/use-case/use-unified-cache.md
---
# 残留工作区运行记录阻止服务重启

工作区服务进程与 socket 均已消失，`current.json` 中的服务锁设备号与当前文件不同。`concord workspace show --json` 返回 `WorkspaceServerUnavailable: Invalid server record`，Concord mod 无法读取仓库。

在隔离仓库启动服务，杀死服务并确认操作系统已释放服务锁，移除 socket，再将运行记录中的锁设备号改为不同值，即可复现。损坏的运行记录也导致同一问题。

预期：通过真实服务锁确认没有持有者后，下一次查询重新启动服务；`server stop` 成功。锁仍被占用或无法验证时不得忽略记录错误或覆盖现场。
