---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/follow-changes.md
---
# Concord 面板与可见终端的目录不同

## 现象

Mac 的 production-monitor 布局中，终端 `pwd` 与标题为 `~/Code/reader`，Concord 面板却显示 `~/Beancount`。之前也出现本地 reader、it-infra 与远端 Concord 的错配。

安装文件校验通过，Herdr 加载检查通过，当前 tab 与焦点 pane 正确。补上目录定时观察及读取错误重试后仍可复现，因此不能归因于未更新或只读刷新失败。

## 已有证据

独立诊断 mod 读取到的 `focused().cwd` 与当前 tab 的聚焦 `panes().cwd` 都是正确的 `~/Code/reader`，terminal 与 pane 标识相符，`shown` 为 null。space 的初始 folder 是用户主目录，但不是当前终端目录。

同一诊断 mod 经 Herdr 的真实 `exec` 在该目录运行 `pwd` 与 `git rev-parse --show-toplevel`，两者均返回 reader；`GIT_DIR` 与 `GIT_WORK_TREE` 均为空。`concord --json --root <reader> workspace projection` 返回 `ProjectNotInitialized`，错误的 `details.root` 仍是 reader，符合该仓库尚未初始化的状态。

真实侧栏实例的自动诊断也观察到一次正确读取：props 与 ownPane 均为空，tab 与当前焦点一致，reader 的目标、已解析根目录、会话根目录及 CLI 参数一致，没有远端缓存混入。安装脚本随后进入 mod 目录，宿主上报该子进程的 cwd；mod 相应进入 `not-git`，reader 只保留为旧会话根目录。这段采样没有捕获原来的错位。

错位时的同一实例中，focus、tab、observedTarget、target 与 reader 的缓存根目录都正确，但活动会话 root 与 machine 仍是远端 Concord，且没有发出新的 reader 查询。错误原文为 `cx.notify() is not allowed during the render phase; request a re-render from an event handler instead`。

`render` 调用 `followTerminal`；缓存命中时，`spawn` 回调在首次等待之前调用 `finishEditing`，其重绘通知被宿主拒绝。目标已记录，会话未切换，后续同一目标的观察直接返回。测试宿主原先把所有 spawn 回调自动延后，未模拟这条宿主边界。

## 复现

先打开本地仓库，再切到远端仓库，再切回已缓存的本地仓库。通过真实 View 与同步启动任务的宿主边界运行：`bun run test test/model/herdr-mod-host.test.ts`。

## 期望

Concord 跟随当前可见终端的真实目录与机器。切换后不显示其它仓库的文档、错误或初始化操作；缓存命中时也必须遵守宿主的绘制与通知边界。
