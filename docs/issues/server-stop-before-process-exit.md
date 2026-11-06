---
relations:
  - role: adopts
    target: docs/feature/local-sdlc/cli.md
---

# server stop 在服务进程退出前返回

## 现象

`server stop` 在服务锁释放后即返回 0，此时服务进程可能仍在运行。完整门禁中 `browser-shared-fixture` 的 success 与 timeout 两项在 Scope 退出、实例记录与 socket 已删除后，工作区服务 PID 仍可 `kill(0)`（`/tmp/concord-closure/lead5-full-gate.log:3879`、`:3912`）。空闲诊断：一例为僵尸进程（`/tmp/concord-closure/lead5-stop-proc-state.log:17`，状态 Z），另一例为仍在运行的真实 node 服务进程（同文件 `:38`，状态 R，断言时仍为 R）。`waitForWorkspaceStop` 只等待锁释放。

## 期望

`server stop` 在服务进程本身已经退出后才返回 0（[CLI](../feature/local-sdlc/cli.md)）。已退出指进程不再运行；僵尸进程已经退出，stop 不是它的父进程，不等待别人回收它。生命周期测试按进程状态判断是否退出，不把僵尸当作仍在运行，也不放宽对仍在运行的进程的拒绝。

## 复现

`browser-shared-fixture` 的三种模式在 Scope 退出后检查工作区服务进程状态。回归测试中的进程状态断言随失败的回归一起提交，修复提交只改产品代码。
