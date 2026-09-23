# Decision

## Decision

Selected: [source-owned](plans/source-owned/README.md)

## Rationale

禁用表达与概念表各自保留事实来源；Web 组合管理，只增加固定路径的受限政策写入。独立 Herdr GPT-6 Astra 挑战给出 CONDITIONAL；六项有限条件已经逐项写入候选，父 agent 核对通过。实现必须逐项验收，设计通过不代替测试。

## Rejected Options

unified-json 会转移既有概念表身份和编辑职责，要求数据迁移与双份维护过渡，超出本轮必要范围。

## Residual Risks

MDX 不执行表达式，SVG 使用受限文本提取。任意编辑器可修改原文件，检查需要输入前后复核；Web 命中必须明确时效。设计通过不代替实现验收。
