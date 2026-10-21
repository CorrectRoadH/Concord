---
format: concord.document/v1
id: test-linkage-requirements
title: 测试关联、多框架、LSP 与受控写作的需求裁决
createdAt: 2026-10-21T07:41:32.988Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

# 测试关联、多框架、LSP 与受控写作的需求裁决

2026-10-21 用户提出四项需求，并在提问中作出以下选择：

- ASD-STE100：中英文都要。英文按 STE 规则类别，中文用改编规则。
- 规则范围：按段落类型区分。程序性条款（有序列表）用严格规则，说明性段落用宽松规则。
- 旅程粒度：Use Case 主流程的步骤，测试关联到具体步骤。
- 关联证据：显式步骤标记加检查，以及静态推导交叉核对。不采用运行时覆盖和文本相似度。

用户随后补充：不同语言、不同框架的测试无法标记到原生用例，并要求加入 LSP。

主 agent 据此写出四份待审 Design：
- `docs/design/test-journey-steps`
- `docs/design/test-adapters`
- `docs/design/lsp-integration`
- `docs/design/controlled-writing`

另写了 Research `docs/research/ste-writing-rules`。四者都属于重大定案，定案前先交给原生 Codex 做独立审查。
