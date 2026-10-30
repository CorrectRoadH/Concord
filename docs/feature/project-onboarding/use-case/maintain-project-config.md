---
format: concord.document/v1
id: maintain-project-config
title: 安全维护项目配置
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 安全维护项目配置

## 用户目标

维护者只在需要 runner 或偏离约定时写配置，获得 TypeScript 类型提示，并保持读取、编辑、验证和恢复行为一致。

## 配置项

`concord.config.ts` 可以不存在，此时全部配置项取默认值（[决策依据](../../../design/sdd-core-model/DECISION.md)）。

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `runner` | 无 | 需要 `test run` 或修复核验时 |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需 |

显式的 `testRoots` 或 `sourceRoots` 替换对应默认值，不与默认值合并。发现范围、runner 输入与 Web 的源码写入范围分别定义；默认值不扩大 Web 的源码写入范围。`sourceIgnore` 的匹配与显式来源优先级见[发现测试](../../local-sdlc/use-case/discover-annotated-tests.md)。

## 完整路径

1. 直接创建或编辑 `concord.config.ts`：一个 `export default` 字面对象，可带类型导入、`as const` 与 `satisfies`；不执行消费者模块。
2. Web 设置页读取配置原文与摘要，保存时以 `config.set` action 按相同前像提交，拒绝覆盖外部编辑。
3. 新命令读取新配置；已有文档不被隐式重写。
4. 若 Concord 的写入中断，按冻结配置快照恢复；不依据外部新配置扩大权限。

## 无效输入

运行时只读取 `concord.config.ts`，按当前 Schema 严格解码（[C-009](../../../constitution.md#c-009-1)）；未列出的字段是无效输入，其它文件不是配置，不被读取或检测。所有入口（CLI、init、dry-run、recover、workspace）对同一现场给出同一结果：

| 错误 | 触发条件 |
| --- | --- |
| `InvalidConfigSyntax` | 重复键、spread、computed key、调用、其它运行时表达式或额外语句 |
| `InvalidData` | 配置或未完成事务不符合当前 Schema |

拒绝不改变配置、journal、锁、事务目标与临时文件的内容、存在性或权限；无法解码的 journal 阻断写入。

## 可观察验收

- 非法运行时表达式、重复键与不安全路径明确拒绝且不执行消费者代码；JS 调用方绕过类型传入非法配置同样拒绝。
- CAS 使用同一次读取的 source，拒绝覆盖外部编辑；`config.set` 可规范化 TS 全文件，但恢复逐字节还原。
- init 配置发布前后、`config.set` 发布前后与源码写入的中断都能恢复；恢复再次中断可以重试。
- 没有配置的仓库中，`test/` 与 `src/` 下的标记被发现；配置 `testRoots` 后只发现配置的根。
- 配置中出现未列出的字段时返回 `InvalidData`，保留原文。
- 无法解码的 journal 与残缺 TS scope 的拒绝早于任何锁删除。畸形配置和宪法缺失不使恢复覆盖未知内容，也不阻断 `recover`。

## Spec 来源

[目标与范围](../README.md)；实现边界见[架构](../architecture.md)。配置采用不执行消费者代码的静态 TS 数据（[决策依据](../../../design/onboarding-contracts/DECISION.md)）。
