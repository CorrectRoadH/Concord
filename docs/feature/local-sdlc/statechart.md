# 外部观察槽位的状态

收集测试与语言分析共用一个[外部观察槽位](../portable-coordination/concepts.md#observation-slot)。观察可能被取消、超时或随服务停止，子进程组可能清理不干净，占用者可能直接死亡，用户还会手动解除；与此同时，文档写入、关系查询和 Issue 关闭照常进行。这一页用模型检查器穷举这些交错，核对[恢复本地状态](use-case/recover-local-state.md)中的槽位规则。

## 规则

### 同一时刻只有一个观察 {#AtMostOneObservationOwner}

一个项目同一时刻最多一个收集或分析占用槽位；第二个请求返回 `RepositoryBusy`。

### 清理未确认时槽位保持阻断 {#UnknownCleanupKeepsSlotBlocked}

子进程组的清理结果未知、且没有合规的人工解除时，后续观察取不到槽位。

### 人工解除只针对已死亡的本机占用者 {#ManualReleaseRequiresCurrentDeadLocalOwner}

解除必须带当前占用的 token，占用者在本机且已经死亡，用户已确认子进程清理完毕。旧 token 或其它主机的占用不能解除。

### 观察阻断不拒绝写入 {#BlockedObservationDoesNotRefuseWrites}

槽位阻断只影响后续的外部观察；其它条件满足时，文档写入、关系查询与 Issue 关闭照常完成。

### 来源变化后的旧观察不发布 {#CurrentObservationRequiresCurrentInputs}

观察运行期间来源文件改变时，这次结果不作为当前结果发布。

## 模型

```statechart spec="./tla/ObservationSlot.tla" config="./tla/observation-slot.cfg" view="./tla/observation-slot-view.ts" out="./tla/out/observation-slot" digest="sha256:8ff6bee98039eb9333524a25ab8ed3e2d26767b4b5f8ed1cf9e288009e604a22"
```

一个项目，收集与分析各请求一次，各带一个 token，谁都可能先取得槽位。一个进程组代表这次观察的全部子进程，只区分存活、确认已清理与未知。占用记录在占用者死亡后保留。一次来源改变来自编辑器或文档写入。五条规则都成立；逐条去掉约束的变体各自找到对应的反例，说明模型能发现这些错误。

模型把发布前的最后一次来源核对与发布写成同一步。编辑器在两者之间直接改文件时，这次结果仍可能被当作当前结果；这段窗口不在模型内。

图把取消、超时、服务停止与主进程结束四种开始收尾的方式合并为一条箭头，隐藏拒绝第二个观察、拒绝解除、丢弃迟到的完成、编辑器写入、文档提交、关系查询与 Issue 关闭等不改变图上状态的步骤。

## 实现与模型的差异

| 情形 | 现在的实现 | 规则 |
| --- | --- | --- |
| 人工解除 | 只删除占用、运行状态与隔离标记，不回收登记的收集产物目录 | [恢复本地状态](use-case/recover-local-state.md)：解除时回收收集产物目录 |
| 解除后另一观察立即领取 | 解除与回执读取在两段互斥中进行，回执可能报告新占用者，而不是 `released` | [恢复本地状态](use-case/recover-local-state.md)：解除输出 `observationSlot.status: "released"` |

## 动作与代码

| 动作 | 代码 |
| --- | --- |
| 领取槽位、拒绝第二个观察 | `src/base/publication/run-coordination.ts`；`src/base/publication/file-lease.ts` 的独占目录 |
| 收集与分析入口 | `src/domain/tests/test-adapters.ts`；`src/app/code-analysis.ts` |
| 收尾、取消、超时、确认或未知的组清理 | `src/base/process/owned-process.ts` |
| 占用者死亡后的阻断 | `src/base/publication/file-lease.ts` 探测死亡；`src/base/publication/run-coordination.ts` 报告阻断 |
| 人工解除 | `src/entry/cli/cli-command-recover.ts`；`src/app/recovery.ts`；`src/base/publication/run-coordination.ts` 核对 token、主机与 PID |
| 来源核对与发布 | `src/domain/tests/test-adapters.ts`；`src/app/code-analysis.ts` |
| 文档写入、关系查询、Issue 关闭 | `src/base/workspace/storage.ts`；`src/app/trace-queries.ts`；`src/domain/issues/lifecycle.ts` |

## 模型没有覆盖的部分

收集产物的登记与删除、PID 重用、占用记录损坏、服务重新握手、各平台进程组探测的差异、信号与管道的逐步生命周期、批量适配器，以及进度与时限。用户的“子进程已清理”确认被当作事实，模型不核实它。
