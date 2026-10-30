# 以 Spec 驱动开发的核心模型

## Decision

Selected: [derive-duplicates](plans/derive-duplicates/README.md)

## Rationale

derive-duplicates 删除能从路径、一级标题与 Git 推导的全部重复声明与空样板，同时显式保存推导不出的语义：生命周期状态、带角色的关系、远端来源的稳定身份、关闭结论与修复核验。convention-first 删掉了后一类，trimmed-current 保留了前一类。全部文件可以直接编辑，可信度由差异门禁保证，符合用户「agent 直接编辑文件」的要求。

G3: 编辑全部文件不需要命令，修复缺陷少两步；顶层命令仍有 24 个，其中 6 个是维护与集成命令。

G5: 检查与授权保留；退休能力表列出明确放弃的四项（Git-private 收据与 epoch、repository profile 的正式可靠性治理、多个 Memory 来源、documentDefaults），宪法相应修订。

## Rejected Options

convention-first 把带角色的关系、远端身份、写入与采用授权以及修复前的核验一并删除，独立审查 R1、R4、R5 的反例成立。trimmed-current 保留 `id`、`kind`、`title` 与所属 Feature 的重复声明以及重叠的类别，G1、G2 不满足。

## Residual Risks

裁决依据用户 2026-10-30 的「开工」指示作出；独立审查的第二次复核（直接编辑与差异门禁）在裁决时尚未返回，结论返回后按其修订 Spec。修复核验只支持线性路径，其它提交关系返回 FixUnverifiable。差异门禁依赖 CI 对每个变更运行 `check --since <base>`；只在本地运行 `check` 时不重放核验。
