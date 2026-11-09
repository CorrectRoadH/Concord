---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/follow-changes.md
---
# Concord 面板与可见终端的目录不同

## 现象

Mac 的 production-monitor 布局中，终端 `pwd` 与标题为 `~/Code/reader`，Concord 面板却显示 `~/Beancount`。之前也出现本地 reader、it-infra 与远端 Concord 的错配。

安装文件校验通过，Herdr 加载检查通过，当前 tab 与焦点 pane 正确。补上目录定时观察及读取错误重试后仍可复现，因此不能归因于未更新或只读刷新失败。

## 已有证据与待确认项

独立诊断 mod 读取到的 `focused().cwd` 与当前 tab 的聚焦 `panes().cwd` 都是正确的 `~/Code/reader`，terminal 与 pane 标识相符，`shown` 为 null。space 的初始 folder 是用户主目录，但不是当前终端目录。

同一诊断 mod 经 Herdr 的真实 `exec` 在该目录运行 `pwd` 与 `git rev-parse --show-toplevel`，两者均返回 reader；`GIT_DIR` 与 `GIT_WORK_TREE` 均为空。`concord --json --root <reader> workspace projection` 返回 `ProjectNotInitialized`，错误的 `details.root` 仍是 reader，符合该仓库尚未初始化的状态。

这些结果没有显示宿主上报目录、Git 根目录或 CLI 返回目录错误。独立诊断实例不能证明 Concord 侧栏实例内部的绑定与缓存正确；仍须读取该实例的 pane/tab 绑定、观察目标、已解析根目录、会话根目录及实际命令结果，才能建立失败回归。

## 期望

Concord 跟随当前可见终端的真实目录与机器。切换后不显示其它仓库的文档、错误或初始化操作。依据现场边界建立失败回归，再修复；若宿主数据本身矛盾，准备不含私人路径的上游复现材料。
