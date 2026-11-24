# 工作区服务与缓存的状态

这一页用模型检查器穷举三段有限规模的交错：工作区服务在安装更新后的替换与退出、持久缓存的清理与自动失效，以及诊断投影的刷新。每段先写规则，再给模型与检查结果。

## 服务替换与退出

安装包更新后，下一条需要服务的命令会停止旧安装的[工作区服务](../../concepts.md#workspace-server)，再启动当前安装的服务。流程见[启动与裁决](architecture.md#启动与裁决)和[退出](architecture.md#退出)。模型包含两条命令、一个旧实例、一个抢先的其它安装和一个新实例。

### 规则


#### 同一时刻只有一个服务 {#SingleOwner}

任一时刻最多一个进程持有服务锁；打开持久缓存的进程必须持有服务锁。

#### 业务请求只由当前安装处理 {#ServedByCurrent}

命令的业务请求只由与这条命令的 CLI 安装身份一致的实例处理，旧安装的实例不会回答。

#### 一条命令最多替换一次 {#OneReplacementPerCommand}

一条命令最多停止一次旧实例。另一安装抢先取得服务时返回 `WorkspaceServerBusy`，不循环替换。

#### 旧实例持锁时不启动新实例 {#NoStartWhileHeld}

旧实例仍持有服务锁时，包括它停在 stopping 不退出时，启动者不拉起新实例去争锁。

#### 残留记录不挡住下一次启动 {#StaleRecordRecovers}

持锁进程已经死亡、只剩运行记录时，下一条命令实际取得并释放服务锁后，启动当前安装的服务并得到结果。

#### 升级最终完成 {#UpgradeEventuallyServes}

安装更新后，需要服务的命令最终由当前安装的实例处理。

现行 Spec 下这条规则不成立：旧实例在退出流程中挂起时，Concord 报告 `CleanupFailed` 并保留现场，不强制结束旧进程，也不删除服务锁，后续每条命令都得到同样的错误，直到旧进程被外部结束。这是不冒充交接完成的代价。已知的一种挂起来源是 Unix 监听的关闭回调迟迟不到，[退出](architecture.md#退出)第 5 步改为确认监听句柄与连接已关闭后继续，不再等待这个回调。

### 模型

```statechart spec="./tla/WorkspaceService.tla" config="./tla/current.cfg" view="./tla/workspace-service-view.ts" out="./tla/out/current" digest="sha256:e713a57387500615c9646098c8110ab763daf3d9be989cdad41273e040a112eb"
```

模型固定一个工作区和两条依次运行的命令。旧实例的清理阶段合并为：请求与子进程、持久缓存、剩余资源、释放服务锁、进程退出；[退出](architecture.md#退出)中的 `listener` 阶段并入剩余资源。10 秒等待写成一次超时动作。环境可以让旧实例在任一清理阶段挂起，也可以从外部结束旧进程；这两个动作不受公平性约束，其余动作有弱公平性。

图隐藏了排空阶段与释放锁之后的挂起箭头，只画持久缓存与剩余资源两处挂起；外部结束只画第一次 `CleanupFailed` 之后的一条恢复路径。新实例取锁、发布记录、打开缓存与握手合并为一个状态。模型检查器仍检查被隐藏和合并的步骤。

### 打破规则的路径

`UpgradeEventuallyServes` 的最短路径：第一条命令发现旧安装的实例，按 token 请求退出；旧实例关闭持久缓存后挂起；第一条命令等待 10 秒后返回 `CleanupFailed`；第二条命令发现旧实例仍在 stopping，等待后同样返回 `CleanupFailed`，此后停在这里。改为在剩余资源阶段挂起，路径相同，`CleanupFailed.details.phase` 为 `resources`，与 2026-11 在一个旧安装服务上观察到的现场一致。

重放：在旧安装副本中让退出流程分别停在持久缓存与剩余资源阶段，用当前 CLI 连续运行两条需要服务的命令，两条都返回带阶段、PID 与 token 的 `CleanupFailed`；结束这个旧进程后，下一条命令由新实例处理。监听回调的回归测试用 `@spec` 指向本节规则。

### 动作与代码

| 动作 | 代码 |
| --- | --- |
| 发现安装身份不符 | `src/entry/cli/main.ts` 核对运行记录、握手 token、协议与安装身份 |
| 按 token 请求退出、等待退出、超时报告 | `src/entry/cli/main.ts` 的替换流程与 10 秒等待；服务端 `src/entry/server/service.ts` 进入 stopping |
| 旧实例逐阶段清理 | `src/entry/server/main.ts` 的关闭链与阶段发布；记录、socket 与锁由 `src/base/server-lock/` 清理和释放 |
| 试取并释放服务锁 | `src/base/server-lock/runtime.ts` |
| 另一安装抢先、替换次数用尽 | `src/entry/cli/main.ts` 的竞争等待与 `WorkspaceServerBusy` |
| 新实例启动、取锁、发布、打开缓存、握手 | `src/entry/cli/main.ts` 启动子进程；`src/entry/server/main.ts` 与 `src/base/server-lock/runtime.ts` |

### 模型没有覆盖的部分

同一安装的并发启动者、协议版本变化、新实例启动失败、文件权限与 inode 身份错误、在途写入、远程 Herdr core 托管的服务，以及挂起的具体原因。挂起只作为环境动作出现，模型不说明哪段代码会挂起。

## 缓存清理与自动失效

`cache clear` 与打开时发现旧格式后的自动清理共用[清理](architecture.md#清理)协议，自动清理另须满足[缓存 schema 自动失效](architecture.md#cache-schema-invalidation)的证据条件。模型包含一个持久 owner、一个正在执行的业务请求、一个直接使用官方 HawDB 适配器的外部打开者、根引擎锁与一把代表全部子锁的锁，以及一份缓存数据。

### 规则

#### 删除前原生操作已经结束 {#ClearWaitsForNativeDrain}

开始删除时，正在执行的原生调用已经返回，旧句柄已经关闭。调用方取消只提出取消请求，不算结束。

#### 删除前独占且清单已核对 {#DeleteRequiresVerifiedExclusiveInventory}

删除时持有服务锁、Concord 准入锁与全部相关引擎锁，缓存目录与锁的身份已按协议核对。

#### 只删缓存数据 {#ClearPreservesLockFilesAndSources}

删除只触及允许删除的缓存数据；锁文件的 inode、来源文件、证据与发布 journal 保留。

#### 自动清理需要当前的旧格式证据 {#AutomaticClearRequiresCurrentSchemaEvidence}

没有确认旧格式，或旧格式观察已因允许范围以外的变化失效时，不自动删除。失活 root-pin 记录的精确变化在允许范围内。

#### 重开被抢占时不再删除 {#BusyReopenNeverDeletesAgain}

本次清理已经删除后，外部打开者抢先取得引擎锁时，重开返回 `HawdbBusy`，不发生第二次删除。

### 模型

```statechart spec="./tla/clear/CacheClear.tla" config="./tla/clear/current.cfg" view="./tla/clear/cache-clear-view.ts" out="./tla/clear/out/current" digest="sha256:f3f5ee5e9a327a3e7e6cd7355f42e1d0ec87fdf384ae2727d93891149e1b42f5"
```

```statechart spec="./tla/clear/CacheClear.tla" config="./tla/clear/root-pin.cfg" view="./tla/clear/cache-clear-view.ts" out="./tla/clear/out/root-pin" digest="sha256:590a4d633b7888ffa2ffd8d37caeb88dfae0ac10da35cc51b657d40fb3026c63"
```

第一份配置覆盖显式 `cache clear`，以及打开时识别出当前格式、确认旧格式与未知格式三种情况。第二份配置只看确认旧格式的自动清理：关闭旧句柄会更新失活 root-pin 记录，同时检查父目录换 inode 等不允许的变化。两份配置下五条规则都成立。

外部打开者每次只记录决定本轮争用结果的那把锁；一条轨迹最多一次一般变化，可以叠加一次允许的 root-pin 更新。图隐藏取消位设置、外部取得或释放锁、同大小改写、目录或锁身份变化等环境步骤，外部争用显示为两个阶段的失败箭头。

### 动作与代码

| 动作 | 代码 |
| --- | --- |
| 显式清理进入排空、停止准入 | `src/entry/server/service.ts` 的维护互斥与 draining；`src/entry/server/main.ts` 暂停操作准入 |
| 取消与原生调用返回 | `src/base/cache/worker-client.ts` 设置取消位并等待活动请求；`src/base/cache/worker-entry.ts` 等同步调用返回才回复 |
| 识别当前格式、旧格式或未知格式 | `src/base/cache/hawdb-native.ts` 读取版本或识别 `unsupported_storage_format`，关句柄前记录目录身份 |
| 取得引擎锁、核对清单 | `src/base/cache/hawdb-lock.ts`；`src/base/file-lock/lock.ts` 的非阻塞 flock |
| 复核旧格式观察、删除 | `src/base/cache/worker-entry.ts` 与 `src/base/cache/cache-file.ts` |
| 释放清理锁、重开 | `src/base/cache/worker-entry.ts` 与 `src/base/cache/hawdb-native.ts`；失败时 `src/entry/server/service.ts` 进入 blocked |

### 模型没有覆盖的部分

逐文件删除与部分 I/O 失败、删除预检与每次 unlink 之间的文件系统竞态、删除后解析缓存写回、多个持久 owner、排队请求、超时、Worker 意外退出，以及同一服务的重复尝试。五条规则只覆盖一次尝试：自动清理重开失败后服务进入 degraded 再次打开的后续尝试不在模型内。

## 诊断投影的刷新

`trace show`、`trace gaps` 与 `review` 读取后台算好的[诊断投影](architecture.md#刷新)。同一查询的多个刷新请求会合并，扫描期间来源可能被编辑、配置可能改变，发布时数据库可能被占用。

### 规则

#### 合并的扫描开始于请求之后 {#CoalescedAttemptStartsAfterRequest}

一个刷新请求被某次扫描满足时，这次扫描开始于请求之后。

#### 身份变化时丢弃候选 {#IdentityChangeDiscardsCandidate}

扫描前后投影身份不同时，候选结果、lastAttempt 与 error 都不发布，以新身份重新刷新。

#### 漂移保留一致的结果 {#DriftKeepsLastConsistentRecord}

扫描期间来源漂移、结果不一致时，不替换已有的一致结果。

#### 失败保留上一代结果 {#FailedRefreshKeepsPreviousResult}

刷新失败只记录新的错误，保留此前的结果与 lastAttempt。

### 模型

```statechart spec="./tla/query-refresh/QueryRefresh.tla" config="./tla/query-refresh/requests.cfg" view="./tla/query-refresh/query-refresh-view.ts" out="./tla/query-refresh/out/requests" digest="sha256:487a823220fad4fa65e9060794409bea9ea12bd5f504a5cb79f1460dc77b1d47"
```

```statechart spec="./tla/query-refresh/QueryRefresh.tla" config="./tla/query-refresh/identity.cfg" view="./tla/query-refresh/query-refresh-view.ts" out="./tla/query-refresh/out/identity" digest="sha256:bb06e23bcbdb26123de07f8ac7bd5a68a8ed8645716053aa8f2b973908d32cfd"
```

```statechart spec="./tla/query-refresh/QueryRefresh.tla" config="./tla/query-refresh/envelope.cfg" view="./tla/query-refresh/query-refresh-view.ts" out="./tla/query-refresh/out/envelope" digest="sha256:469582def9c685646235430eebf80d17aa4242a51084bf3420a598c35ef04baa"
```

```statechart spec="./tla/query-refresh/QueryRefresh.tla" config="./tla/query-refresh/all.cfg" view="./tla/query-refresh/query-refresh-view.ts" out="./tla/query-refresh/out/all" digest="sha256:a42e03d86ed9654d6e3ea442ffe5b95366da80bc07b7f4f0a8daca28defb911a"
```

两个请求、两个身份、一个扫描槽。前三块分别看请求合并与断开取消、排队到重试之间的身份变化、已有结果上的替换与保留；最后一块把它们合在一起，状态数超过图的规模上限，只显示检查报告。四条规则都成立。图隐藏断开、身份变化、来源编辑与终态步骤，它们的效果体现在丢弃与入库结果上。

### 按路径重放的测试

`test/domain/asynchronous-projections-generation.test.ts` 重放两条路径：排队时身份改变，请求按新身份重新排队而不是丢失；入库重试跨过三秒期限后不再写入，保留原结果并返回最近一次可重试失败。

### 动作与代码

| 动作 | 代码 |
| --- | --- |
| 请求刷新、断开 | `src/entry/server/main.ts` 的刷新调度 |
| 身份与来源变化 | `src/app/query-cache.ts`；`src/base/workspace/identity.ts`；`src/app/query-scan.ts` |
| 等待同一查询的刷新、扫描、取消 | `src/app/query-refresh.ts`；`src/app/query-scan.ts`；`src/base/process/owned-process.ts` |
| 丢弃、重新请求、入库等待与到期 | `src/app/query-refresh.ts`；`src/app/query-refresh-store.ts` |
| 发布 | `src/app/query-cache.ts`；`src/base/cache/owner.ts` |

### 模型没有覆盖的部分

多个独立查询、同毫秒与时钟回拨、具体正文与错误码、输出量与进程组清理细节、等待同一查询的另一个刷新超时的路径，以及前台当前投影。
