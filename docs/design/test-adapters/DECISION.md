# 多框架测试 adapter

## Decision

Selected: [process-adapter](plans/process-adapter/README.md)

## Rationale

process-adapter 保持源码标记为唯一关联来源，adapter 只在显式收集与执行时提供原生观察，并保留 `@native` 作为显式选择后备。协议拆成计划与解析两步，进程由 Concord 管理并裁决状态，收据逐项核对 requested 与 observed。C-011 第 1、6 款已修订，全部 Limit 满足。

G1: 自动绑定依赖框架能否给出完整声明范围。能力矩阵中未经固定版本验收的组合不宣称支持，范围缺失时回退到 `@native` 或文件级执行。

G2: 重复名称、动态子测试与多 binary 需要框架提供精确选择能力，不能通用承诺；不具备时具名失败或明确按文件执行。

G3: 逐项结果需要固定 provider 与报告 codec 的身份映射验收，未验收的组合不签发原生结论。

G4: 原生标签只作为 provider 返回的展示元数据，不拥有关系；可用性依框架版本。

## Rejected Options

marker-extension 只提供手写 `@native` 选择，没有真实收集，G1 与 G4 不满足；重命名测试后标记与源码脱节，只在执行时才发现。它的显式选择能力已作为 process-adapter 的后备保留。

## Residual Risks

- 各框架内置 adapter 只能覆盖本机可验证的版本；JVM provider 未验证，不内置。
- adapter 与框架是受信程序，进程组管理不是沙箱。
- 新收据版本使旧收据只能作为历史，需要重新取证。
