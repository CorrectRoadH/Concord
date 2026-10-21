# 受控写作规则

## Decision

Selected: [policy-rules](plans/policy-rules/README.md)

## Rationale

policy-rules 在 `concord.writing/v3` 中内置受控写作规则，按目录作用域合成，门禁只读输入快照，不依赖外部进程。字符长度路径保持现有语义，controlled token 路径独立计数，中英文分别处理。全部 Limit 满足；性能预算已定义，实测是实现验收条件。

G3: 动作词出现次数不能证明指令数量，规则默认关闭，finding 只陈述"命中多个受控动作词"。

G4: 动作词表与英文批准词是词面匹配，不推断词性；中文批准词需要分词，不提供。

G5: 被动语态只报告受控模式的命中，英文依赖显式过去分词表，中文只检查"被"，允许局部字面豁免。

## Rejected Options

external-linter 让外部工具只作显式建议来源，不进入门禁。它不提供中文计数，也需要额外的 runner 协调；内置规则已覆盖门禁所需能力，因此未选。

## Residual Risks

- 中文阈值需要用项目语料校准，预设值不是 STE 规范数值。
- 词法规则的误报与漏报需要按 CASES 的语料验收记录。
- v3 迁移要求所有接入项目执行一次 `writing migrate`。
