# Goals

## G1: First projection under continuous edits

持续编辑的工作区在一次刷新扫描能于刷新上限内完成时，就能得到第一份可读投影，不因扫描期间的普通编辑而持续 QueryPending。判据为场景 C1、C2。

## G2: Explainable refresh state

用户与 agent 能从 JSON 区分扫描超时、输出超限、恢复待处理、身份变化重试与扫描具名失败，并看到耗时与上限，不需要手动复现扫描。判据为场景 C3、C4。

## G3: One drift semantics

诊断投影与工作区导航投影对来源漂移使用同一套 `consistent`、`complete`、`changedPaths`、`unknownRelations` 语义和替换规则，读者不需要按入口记两套规则。判据为场景 C5。
