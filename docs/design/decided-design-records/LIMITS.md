# 已裁决的 Design 只保留决策记录

## L1: 一个事实一个 owner

每项事实只有一个 owner，反向关系派生（[C-001](../../constitution.md#c-001)）。通过条件：迁移后同一规则不同时以规范性陈述出现在 Spec 与候选页中作为现行依据。

## L2: 不改写历史记录

Design 的候选与裁决由各自 owner 保留，本规则不授权删除或改写既有证据、来源及生命周期历史（[C-012-6](../../constitution.md#c-012-6)）。通过条件：迁移不删除、不移动 Design 包文件，不改变 decision 元数据。

## L3: 路径即身份

文档路径是 canonical identity（[架构 · 存储 Spec](../../architecture.md#存储-spec)）。通过条件：迁移不移动任何文件。

## L4: 宪法修订按程序采用

修订说明适用范围、理由、来源和影响，由 `concord constitution amend` 记录（[C-008](../../constitution.md#c-008-2)）。

## L5: 公开输出只增不改

新增 finding 代码不改变既有字段与错误码含义（[C-015](../../constitution.md#c-015-2)）。
