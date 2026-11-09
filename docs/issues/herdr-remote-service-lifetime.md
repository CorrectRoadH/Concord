---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
  - role: spec
    target: docs/feature/herdr-mod/use-case/follow-changes.md
---
# Herdr 远程查询回收服务后持续加载

## 观察

远程 Voices 仓库的 mod 持续显示“正在读取 Concord 仓库…”。`hc exec` 运行 `concord workspace wait` 后回收其 detached 服务；下一次投影读取再次返回 `WorkspaceProjectionPending`，mod 无限重试。布局侧栏切换到同一机器、同一仓库的另一个 tab 也会重新启动查询与变化等待。

## 期望

远程服务由 Herdr core 独立托管，与终端 CLI 双向复用；服务正常退出后托管终端删除。首次投影等待有界，失败可见。同仓库切换 tab 保留原页面、编辑状态与变化等待，不发额外查询。

## 复现

在没有工作区服务的已初始化仓库中，经 `hc exec` 连续运行 `concord --json workspace wait` 与 `concord --json workspace projection`。前者可能返回结果，但服务 PID 随命令退出消失，后者再次 pending。打开远程 mod 可观察持续加载。另开指向同一仓库的 tab，切换并观察重复的查询与等待。
