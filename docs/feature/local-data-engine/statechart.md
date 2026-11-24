# 工作区服务的状态

安装包更新后，下一条需要服务的命令会停止旧安装的[工作区服务](../../concepts.md#workspace-server)，再启动当前安装的服务，见[启动与裁决](architecture.md#启动与裁决)和[退出](architecture.md#退出)。这一页用模型检查器穷举两条命令、一个旧实例、一个抢先的其它安装和一个新实例之间的全部交错，说明哪些规则成立、哪条路径打破规则。

## 规则

### 同一时刻只有一个服务 {#SingleOwner}

任一时刻最多一个进程持有服务锁；打开持久缓存的进程必须持有服务锁。

### 业务请求只由当前安装处理 {#ServedByCurrent}

命令的业务请求只由与这条命令的 CLI 安装身份一致的实例处理，旧安装的实例不会回答。

### 一条命令最多替换一次 {#OneReplacementPerCommand}

一条命令最多停止一次旧实例。另一安装抢先取得服务时返回 `WorkspaceServerBusy`，不循环替换。

### 旧实例持锁时不启动新实例 {#NoStartWhileHeld}

旧实例仍持有服务锁时，包括它停在 stopping 不退出时，启动者不拉起新实例去争锁。

### 残留记录不挡住下一次启动 {#StaleRecordRecovers}

持锁进程已经死亡、只剩运行记录时，下一条命令实际取得并释放服务锁后，启动当前安装的服务并得到结果。

### 升级最终完成 {#UpgradeEventuallyServes}

安装更新后，需要服务的命令最终由当前安装的实例处理。

现行 Spec 下这条规则不成立：旧实例在退出流程中挂起时，Concord 报告 `CleanupFailed` 并保留现场，不强制结束旧进程，也不删除服务锁，后续每条命令都得到同样的错误，直到旧进程被外部结束。这是不冒充交接完成的代价。已知的一种挂起来源是 Unix 监听的关闭回调迟迟不到，[退出](architecture.md#退出)第 5 步改为确认监听句柄与连接已关闭后继续，不再等待这个回调。

## 模型

```statechart spec="./tla/WorkspaceService.tla" config="./tla/current.cfg" view="./tla/workspace-service-view.ts" out="./tla/out/current" digest="sha256:e713a57387500615c9646098c8110ab763daf3d9be989cdad41273e040a112eb"
```

模型固定一个工作区和两条依次运行的命令。旧实例的清理阶段合并为：请求与子进程、持久缓存、剩余资源、释放服务锁、进程退出；[退出](architecture.md#退出)中的 `listener` 阶段并入剩余资源。10 秒等待写成一次超时动作。环境可以让旧实例在任一清理阶段挂起，也可以从外部结束旧进程；这两个动作不受公平性约束，其余动作有弱公平性。

图隐藏了排空阶段与释放锁之后的挂起箭头，只画持久缓存与剩余资源两处挂起；外部结束只画第一次 `CleanupFailed` 之后的一条恢复路径。新实例取锁、发布记录、打开缓存与握手合并为一个状态。模型检查器仍检查被隐藏和合并的步骤。

## 打破规则的路径

`UpgradeEventuallyServes` 的最短路径：第一条命令发现旧安装的实例，按 token 请求退出；旧实例关闭持久缓存后挂起；第一条命令等待 10 秒后返回 `CleanupFailed`；第二条命令发现旧实例仍在 stopping，等待后同样返回 `CleanupFailed`，此后停在这里。改为在剩余资源阶段挂起，路径相同，`CleanupFailed.details.phase` 为 `resources`，与 2026-11 在一个旧安装服务上观察到的现场一致。

重放：在旧安装副本中让退出流程分别停在持久缓存与剩余资源阶段，用当前 CLI 连续运行两条需要服务的命令，两条都返回带阶段、PID 与 token 的 `CleanupFailed`；结束这个旧进程后，下一条命令由新实例处理。监听回调的回归测试用 `@spec` 指向本节规则。

## 动作与代码

| 动作 | 代码 |
| --- | --- |
| 发现安装身份不符 | `src/entry/cli/main.ts` 核对运行记录、握手 token、协议与安装身份 |
| 按 token 请求退出、等待退出、超时报告 | `src/entry/cli/main.ts` 的替换流程与 10 秒等待；服务端 `src/entry/server/service.ts` 进入 stopping |
| 旧实例逐阶段清理 | `src/entry/server/main.ts` 的关闭链与阶段发布；记录、socket 与锁由 `src/base/server-lock/` 清理和释放 |
| 试取并释放服务锁 | `src/base/server-lock/runtime.ts` |
| 另一安装抢先、替换次数用尽 | `src/entry/cli/main.ts` 的竞争等待与 `WorkspaceServerBusy` |
| 新实例启动、取锁、发布、打开缓存、握手 | `src/entry/cli/main.ts` 启动子进程；`src/entry/server/main.ts` 与 `src/base/server-lock/runtime.ts` |

## 模型没有覆盖的部分

同一安装的并发启动者、协议版本变化、新实例启动失败、文件权限与 inode 身份错误、在途写入、远程 Herdr core 托管的服务，以及挂起的具体原因。挂起只作为环境动作出现，模型不说明哪段代码会挂起。
