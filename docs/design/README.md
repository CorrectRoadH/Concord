# Design

Design 在共同目标与限制下比较自包含候选，通过 `design decide` 保存唯一选择、目标和理由。选择、目标、时间和来源保持不变；理由可通过带摘要前像的 `design correct-reason` 更正，更正来源与说明由 Memory 保留。候选页面不是第二份 metadata 真源。

使用 `concord design list` 查看全部裁决，`concord design show <path>` 查看选择与目标，`concord design create --help` 创建。

候选支持单文件与目录形式，规则见 [Plan 内容布局](plan-content/README.md)。
