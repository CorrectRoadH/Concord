# 路径注释

一个真实顶层测试声明通过 `@feature` 或 `@use-case` 直接指向契约。测试名称保持自然语言描述，多测试可指向同一契约。工具由 native 文件、声明文件及名称派生执行引用，无需作者维护 ID。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-只采用路径注释关联方式) | satisfied | 使用 `@feature` / `@use-case`，不使用旧 ID、标题 token 或 testing owner。 | 原候选正文明确描述路径注释并排除手写 ID。 |
| [L2](../../LIMITS.md#l2-每个声明恰有一个契约目标) | satisfied | 每个顶层声明直接指向一个契约，多个测试可以指向同一契约。 | 原候选正文明确说明单一直接目标和多测试关系。 |
| [L3](../../LIMITS.md#l3-原生收集与正式执行归消费仓库) | satisfied | Concord 负责解析和关系校验；消费仓库 runner 负责原生收集与正式执行，静态关系不冒充正式执行。 | [候选架构](architecture.md#架构)明确划分 Concord 与消费仓库 runner 的职责；这是设计论证，不是执行证明。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-测试名称保持行为描述) | satisfied | 测试名称保持自然语言，不附加机器 ID。 | 原候选正文明确说明名称保持自然语言描述。 |
| [G2](../../GOALS.md#g2-声明直接建立契约关联) | satisfied | 顶层声明用 `@feature` 或 `@use-case` 直接指向契约。 | 原候选正文明确说明直接契约关联。 |
| [G3](../../GOALS.md#g3-执行引用自动派生且不另存注册表) | satisfied | 引用从 native 文件、声明和名称派生，不要求作者维护 ID。 | 原候选正文明确说明自动派生与无手写 ID。 |
