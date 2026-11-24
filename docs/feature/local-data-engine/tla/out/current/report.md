# WorkspaceService

TLC reached 145 states and 189 steps. The chart draws 16 states and 20 arrows.
The chart does not draw 77 steps that stay in one chart state.
The view hides 22 steps, so the chart does not draw them.

## UpgradeEventuallyServes breaks
TLC's counterexample is in tlc-UpgradeEventuallyServes.out. It has 9 steps:
0. 旧安装正在运行
1. 发起下一条需要服务的命令: 当前命令检查旧实例
2. 握手并核对运行记录: 服务由不同安装的实例占用
3. 按实例 token 请求退出: 旧实例排空请求和子进程
4. 完成在途工作和子进程清理: 旧实例关闭持久缓存
5. 退出流程挂起: 旧实例退出流程挂起
6. 等待 10 秒后报告清理阶段: 第一条命令返回 CleanupFailed
7. 发起下一条需要服务的命令: 第二条命令发现旧实例挂起
8. 等待正在退出的实例: 第二条命令等待旧实例退出
9. 等待 10 秒后报告清理阶段: 第二条命令也返回 CleanupFailed
The run stops in "第二条命令也返回 CleanupFailed" forever.

## Rules that hold
SingleOwner, ServedByCurrent, OneReplacementPerCommand, NoDeadlock, NoStartWhileHeld, StaleRecordRecovers
