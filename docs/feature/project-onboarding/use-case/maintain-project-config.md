---
format: concord.document/v1
id: maintain-project-config
title: 安全维护项目配置
kind: use-case
feature: docs/feature/project-onboarding/README.md
---

# 安全维护项目配置

## 用户目标

维护者在初始化之后调整项目默认值与来源配置，获得 TypeScript 类型提示，并保持读取、编辑、验证和恢复行为一致。

## 完整路径

1. 仅读取 concord.config.ts，严格校验当前 Schema；格式不符时保留原件并拒绝。
2. 使用静态 export default 对象表达配置：一个字面对象，可带类型导入、`as const` 与 `satisfies`；不执行消费者模块。
3. 通过 `concord config show` 取得正文与摘要，再用 `concord config set --input <json> --expected-digest <digest>` 按相同前像提交修改。
4. 调整后新命令读取新配置；旧文档不被隐式重写。
5. 若发生写入中断，按冻结配置快照恢复；不依据外部新配置扩大权限。

源码与测试自动发现可用 `sourceIgnore` 配置仓库相对路径，匹配与显式来源优先级见[发现测试](../../local-sdlc/use-case/discover-annotated-tests.md)。

## 无效输入

运行时只读取 `concord.config.ts`，只接受当前格式（[C-009](../../../constitution.md#c-009-1)）；其它文件不是配置，不被读取或检测。所有入口（CLI、init、dry-run、recover、workspace）对同一现场给出同一结果：

| 错误 | 触发条件 |
| --- | --- |
| `InvalidConfigSyntax` | 重复键、spread、computed key、调用、其它运行时表达式或额外语句 |
| `InvalidData` | 配置、未完成事务或收据不符合当前 Schema |

拒绝不改变配置、journal、锁、事务目标与临时文件的内容、存在性或权限；无法解码的 journal 阻断写入。缺少当前配置绑定的收据需要重新取证。

## 可观察验收

- 非法运行时表达式、重复键与不安全路径明确拒绝且不执行消费者代码；JS 调用方绕过类型传入非法配置同样拒绝。
- CAS 使用同一次读取的 source，拒绝覆盖外部编辑；普通工具编辑可规范化 TS 全文件，但恢复逐字节还原。
- init 配置发布前后、`config set` 发布前后与源码写入的中断都能恢复；恢复再次中断可以重试。
- 配置仅改变注释也会改变新证据绑定的摘要，使此前的 fixed 证据失效，不改写历史证据。
- 无法解码的 journal 与残缺 TS scope 的拒绝早于任何锁删除。畸形配置和宪法缺失不使恢复覆盖未知内容，也不阻断 `recover`。

## Spec 来源

[目标与范围](../README.md)；实现边界见[架构](../architecture.md)。配置采用不执行消费者代码的静态 TS 数据（[决策依据](../../../design/onboarding-contracts/DECISION.md)）。
