> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代，不代表当前支持。

# 初始化配置与项目治理契约

## Decision

Selected: [compatible](plans/compatible/README.md)

## Rationale

选择 compatible。格式、锚点、恢复授权和组合验收边界见 [governance](plans/compatible/governance.md)。

G1: compatible 原文定义新 init、严格可解析 TS 数据配置和非交互行为，但其部分旧 JSON 运行时兼容后来被 TS-only 裁决替代；历史目标不能据此解释为当前 runtime 支持。

G2: compatible 明确定义必需宪法、可选 DESIGN.md、页面默认值和显式空数组；原文支持该目标。

G3: 原 compatible 方案保留旧 JSON 消费者，但用户后续明确禁止 legacy，TS-only 设计替代运行时兼容部分；本历史裁决保留原选择和时间，不把旧结论改写成当前支持。

G4: compatible 定义 local-files 来源、canonical path 身份、来源内唯一 ID、默认写入来源和只读权限；原文支持 Memory 多来源边界。

G5: compatible 定义宪法引用、修订 CAS 与 review 读取当前正文和摘要；原文支持宪法治理目标。

TS 的允许语法与安全加载、旧配置兼容、Memory 多来源身份与证据边界、宪法修订与恢复协议。

正文不替代 owner metadata 中的裁决。实现验收须覆盖共享协调锁、模型迁移、配置恢复、宪法引用和实际终端冲突。

## Rejected Options

replacement 立即只接受可执行 TS 配置，迁移所有消费者，采用通用跨目录后端与统一来源身份。影响信任边界、历史引用与恢复，迁移和回滚成本更高；未采用。

## Residual Risks

原 compatible 选择的旧配置、journal 和收据运行时兼容规则已由 ts-only 设计替代。本次格式迁移不复验 ts-only 的拒绝分类、旧证据重新取证和离线迁移；原记录证明的范围不扩大，本页保留历史裁决，不声称旧兼容仍受支持。
