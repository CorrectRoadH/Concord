# 写入与恢复的状态

两条命令基于同一份文件规划写入，编辑器随时可能直接改文件，进程可能在写到一半时退出，恢复本身也可能再被打断。这一页用模型检查器穷举这些交错，核对[文件发布](architecture.md#文件发布)与[恢复规则](architecture.md#恢复规则)。

## 规则

### 过期的计划不写文件 {#StalePlanWritesNothing}

进入[写互斥](../../concepts.md#write-exclusion)时，计划依赖的文件已经变化，写入以 `SourceChanged` 拒绝，不留下 journal，也不改任何目标文件。

### 恢复保留外部编辑 {#RecoveryPreservesExternalEdit}

目标文件既不等于写入前内容、也不等于计划内容时，恢复保留磁盘上的文件，清理 journal，并在结果中告警列出这些路径。外部编辑发生在恢复之前或恢复途中都一样。

### 恢复后文件是完整的一版 {#RecoveredFilesMatchOneImage}

没有外部编辑时，恢复完成后全部目标要么都是写入前内容，要么都是这次计划的内容，不出现一半新一半旧。

### 先恢复再应答 {#RecoveryBeforeFirstReply}

服务启动时有上次遗留的 journal，在恢复完成、journal 删除之前不回答业务请求。

## 模型

```statechart spec="./tla/PublicationRecovery.tla" config="./tla/publication-recovery.cfg" view="./tla/publication-recovery-view.ts" out="./tla/out/publication-recovery" digest="sha256:97e2bcb116b094b5607a120641a1c0dc051058b2cd6532b4e9c1c2cef612c0eb"
```

两个写者基于同样的两个文件规划，两个文件既是目标也是依赖；每个文件可能是写入前内容、计划 A、计划 B 或外部内容。一次外部编辑可以落在发布前、发布中、进程退出后或恢复中。最多一次发布中断和一次恢复中断，包括还原已经写入、journal 尚未删除时的第二次中断。新服务从已取得服务锁的时刻开始。四条规则都成立。

模型把“核对目标内容”和“原子替换”写成同一步。真实文件系统做不到：两者之间总有一段很短的窗口，编辑器在这里写入的内容会被替换。实现在每个目标替换前重新核对一次，把窗口缩到最小，但不能消除。

图隐藏编辑器直接写入、写入 committed 阶段、还原单个目标、过期计划的再次拒绝与终态自循环等不改变图上状态的步骤。

## 实现与模型的差异

按模型的动作逐步重放到真实代码，发现三处与本页规则不符，修复时回归测试用 `@spec` 指向对应规则：

| 情形 | 现在的实现 | 规则 |
| --- | --- | --- |
| 最后一个目标已经替换、committed 尚未落盘时退出 | 恢复按 prepared 阶段回滚，两个文件回到写入前内容 | [恢复规则](architecture.md#恢复规则)：已全部匹配计划时按完成处理；见 [RecoveredFilesMatchOneImage](#RecoveredFilesMatchOneImage) |
| 编辑器在恢复检查之后、还原之前写入 | 还原覆盖外部内容，结果为 rolled-back 且没有告警 | [RecoveryPreservesExternalEdit](#RecoveryPreservesExternalEdit) |
| 服务启动时有遗留 journal | 服务直接进入 running，查询返回 `RecoveryRequired`，要求另行运行 `concord recover` | [RecoveryBeforeFirstReply](#RecoveryBeforeFirstReply) |

## 动作与代码

| 动作 | 代码 |
| --- | --- |
| 进入写互斥、核对依赖、写 prepared journal | `src/base/workspace/storage.ts` 的提交入口 |
| 核对并替换单个目标、写 committed、删除 journal | `src/base/workspace/storage.ts` 的发布流程 |
| 编辑器直接写入 | 不经过 Concord；发布与恢复在 `src/base/workspace/storage.ts` 核对摘要 |
| 启动恢复 | `src/entry/server/main.ts` 取得服务锁后的就绪检查；`src/app/workspace-projection.ts` |
| 显式恢复、判定回滚或完成、还原、删除 journal | `src/app/recovery.ts` 分派；`src/base/workspace/storage.ts` 的恢复流程 |
| 回答业务请求 | `src/entry/server/main.ts` 的请求入口；`src/entry/server/service.ts` 的状态检查 |

## 模型没有覆盖的部分

额外的依赖文件、文件删除、[目录发布](architecture.md#目录发布)、Trace 发布、无法解码的陈旧 journal、路径与格式授权、缓存与普通读取快照。规则只检查有限配置下的安全性，不检查调度是否最终推进。
