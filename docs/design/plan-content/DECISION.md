# Decision

## Decision

Selected: [derived-entry](plans/derived-entry/README.md)

## Rationale

候选名是唯一身份，入口由文件系统精确派生，适配不同规模的正文；当前 check 在完整来源核验基础上有界重试。

## Rejected Options

固定目录能承载长文档，但 G1 的短候选仍需额外目录，不能满足用户直接维护 Plan 文件的需求。

## Residual Risks

持续编辑可能耗尽当前检查的重试预算。
