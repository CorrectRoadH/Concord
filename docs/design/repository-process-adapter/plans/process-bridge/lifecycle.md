# 进程调用与迁移

## 一次能力调用

1. Concord 从当前消费者根读取配置，验证 adapter 路径与环境名，捕获引擎、配置及实现文件摘要。

2. 关闭来源快照后，在 Effect Scope 内启动独立进程组，写入请求并关闭 stdin。

3. 消费者完成能力操作。需要治理算法时，调用请求绑定的 engine argv；engine 路由不反向调用 adapter。

4. 消费者返回一个 JSON 并退出。Concord 确认进程组终结，再严格解码并校验所有回显字段及前后摘要。

5. 调用方在现有发布流程中重验当前来源与证据。长期外部执行不持 publication lease。

取消、超时和输出超限触发 TERM、grace、KILL 与进程组消失核验。清理不明时保留失败现场，不签发有效证据，也不靠退出码推断容器已清理。

adapter 自有进程、Sandbox 和容器的终结继续进入原生 receipt。Concord 的进程组清理不能替代这些记录。

## 消费者切换

停用旧 host 进程，确认无 writer 和未完成 journal，再以普通源码改动替换 host 配置、入口与依赖。

不改已有 evidence、resolution、epoch、current relation 或 history；实现身份改变后 managed ID 重新收集。

配置和 adapter 实现的字节进入新来源身份；配置缺失不能降低已持久化的证据要求。

NiceEval runner 的内部库调用改走 engine 客户端，host 改为 stdio 程序，移除 e2e-runner 对 Concord 的包依赖。

repo-tools 自有 CLI composition、文件原语和呈现由 NiceEval 自己拥有；治理查询使用公开命令。

Preview 的公开数据协议另按其 owner 验收，不把删除一种内部 import 说成全部消费者迁移。

## 验收

从打包后公开 CLI 完成 C1、C2、C3；不用伪造收据代替真实执行。NiceEval 用同一安装候选完成 C4，产品 expected 零 diff。

静态检查证明 runner 无 Concord import；真实闭环证明进程协议和证据下限，二者不能替代。

## 嵌套进程的唯一回收 owner

仅外层 Concord 创建 detached POSIX 进程组。请求记录真实 leaderPid，adapter 在入口验证自己是该组 leader。

该请求的 engine 子调用、安装与原生 collection 子进程均继承该组，禁止 setsid/detached 创建独立组。NiceEval OwnedProcess 由 adapter 入口注入 inherited-group 模式；普通独立运行保持既有自有组模式。

继承模式的子任务失败/超时后停止接收新工作，adapter 返回失败并退出，整组终结由外层 Scope 负责。不能在组内向负 PGID 发送信号杀死自己的协调者，也不能把单个 PID 退出当作完整清理。

正常结束后外层发现残留组成员即拒绝成功响应，随后 TERM/grace/KILL 并核验；adapter 忽略 TERM 后被 KILL 时，嵌套 engine/runner 仍在同组，必须全部终结。

不满足可观测 POSIX 进程组能力的平台返回具名不支持错误，不静默声称清理成功。容器等组外资源仍由原生 resource evidence 所有者负责，不由 PGID 消失代证。

新故障验收必须覆盖强杀 adapter 时仍在运行且忽略 TERM 的嵌套子进程，以及清理无法核实时拒绝后续能力调用。
