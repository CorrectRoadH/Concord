# 测试关联到 Use Case 步骤

## Decision

Selected: [step-anchor](plans/step-anchor/README.md)

## Rationale

step-anchor 在主流程根有序列表项上声明显式 ID，正文保持连续列表，ID 与文字和位置无关。它满足全部 Limit，并提供补齐与原子改名工具，降低步骤 ID 的书写与维护成本。步骤语法、身份与观察语义由[共同身份](共同身份.md)统一拥有，adapter 与 LSP Design 引用同一契约。

G3: 相关性判定只报告观察到的正向交集。文件级 import、调用深度上限与子进程黑盒测试都会让"未观察到交集"不等于"行为无关"，因此 `not-observed` 总是附带具名缺口，不输出无关结论。这个缺口来自静态观察的能力边界，诚实呈现优于给出不可证明的判定。

## Rejected Options

step-heading 在同一列表步骤之上增加标题导航。它不提供新的身份能力，却增加正文阅读成本，G4 只能部分满足，因此未选。纯标题作为步骤 owner 的写法违反共同契约的单一步骤语法，不作为候选。

## Residual Risks

- 作者可能把验收列表误标为步骤。解析器不按章节语义排除，`use-case steps` 展示全部步骤供审阅。
- `step-N` 序号不保证永久不复用；被旧引用占用的值不会重新分配。
- rename-step 引入新的跨源码与文档写入范围，中断恢复必须按 CASES C19 验收。
- 黑盒测试的相关性多数为 `not-observed`，需要用正误样本公开结果，不设比例目标。
