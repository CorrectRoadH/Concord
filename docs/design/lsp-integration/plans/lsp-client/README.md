# LSP client

## Problem

外部 language server 可提供符号位置与调用信息，但其能力、范围和索引状态依赖语言与版本。本候选将这些信息限制为显式观察，不把 server 结果作为声明或身份来源。

## Core Mental Model

源码扫描拥有代码关联，`code analyze` 提供符号定位与正向调用观察，`concord lsp` 提供版本一致的编辑器视图。三者遵守[共同契约](../../../test-journey-steps/共同身份.md)，观察缺失不删除关系。

## Scope

覆盖声明式 profile 能表达的语言子集；Python、Go、Rust 与 Java 是兼容性验收目标，不因配置 pyright、gopls、rust-analyzer 或 jdtls 命令即宣称支持。无可验证 profile 的 server 只提供标记行位置或具名定位缺口。

调用分析可观察跨文件调用，不证明闭包完整。文件级结果标明 `FileScope`；黑盒子进程与协议边界允许始终未观察到交集。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不在-concord-进程内运行项目代码或新增原生模块) | satisfied | Concord 维护 TS/Effect 协议实现；server 为受信外部程序，不加载项目模块 | [信任与执行边界](architecture.md#信任与执行边界) |
| [L2](../../LIMITS.md#l2-静态命令不启动外部分析进程) | satisfied | 仅显式 `code analyze` 启动 server；`check` 不读取观察 | [分析生命周期](architecture.md#分析生命周期) |
| [L3](../../LIMITS.md#l3-分析结果只是投影) | satisfied | 共同观察结构只写 HawDB，关系和定位分离 | [身份与输入](architecture.md#身份与输入) |
| [L4](../../LIMITS.md#l4-外部进程资源归-concord-管理) | satisfied | runner 所有权、总预算与清理后重验；未知清理阻断发布 | [分析生命周期](architecture.md#分析生命周期) |
| [L5](../../LIMITS.md#l5-编辑器服务只读且不开网络端口) | satisfied | stdio overlay；明确拒绝编辑和执行请求 | [编辑器服务](architecture.md#编辑器服务) |
| [L6](../../LIMITS.md#l6-typescript-代码声明保持现有规则) | satisfied | JS/TS 声明和派生引用继续由内置编译器计算 | [代码关联与符号定位](architecture.md#代码关联与符号定位) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-非-typescript-代码可以声明实现) | partial | 标记拥有关系；准确符号范围需要语言 profile 与版本兼容证据 | [符号绑定](architecture.md#符号绑定)；[C1/C11](../../CASES.md#场景) |
| [G2](../../GOALS.md#g2-非-typescript-测试得到相关性判定) | partial | 只提供正向观察，动态调用和黑盒边界保留缺口 | [调用观察](architecture.md#调用观察) |
| [G3](../../GOALS.md#g3-编辑器内可以看到-concord-关系) | satisfied | overlay 生命周期、响应版本核对和完整性声明覆盖五类能力 | [编辑器服务](architecture.md#编辑器服务) |
| [G4](../../GOALS.md#g4-新语言不修改-concord-即可接入) | partial | 既有 profile 形态内可配置；新增词法或绑定语义需要 Concord 变更 | [配置与兼容能力](architecture.md#配置与兼容能力) |
| [G5](../../GOALS.md#g5-分析结果可重建) | partial | 关系可重建；观察重现受 server 与环境确定性限制 | [身份与输入](architecture.md#身份与输入) |

## Entry Points

- [Architecture](architecture.md)
