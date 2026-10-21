# tree-sitter

## Problem

固定语法与查询可提供不依赖 language server 的静态符号范围，但不能自动给出跨文件语义调用。引入 WASM runtime 与语法还需要明确的维护和分发边界。

## Core Mental Model

Concord 发行包固定 runtime、Python/Go/Rust/Java grammar 与查询；TypeScript/Effect 组织解析和预算，不加载消费者提供的 WASM 或查询程序。符号范围只是定位，关系身份仍引用[共同契约](../../../test-journey-steps/共同身份.md)。

## Scope

本候选需 C-005 修订，保留为未选候选；本设计不采用该修订。第三方预编译 WASM、Concord 维护 grammar 与消费者上传程序具有不同责任，不能凭 WASM 文件类型直接推断宪法许可。

仅覆盖随包版本与查询验证过的语言。文件级 import 观察不等同测试调用；编辑器服务共用 [LSP client](../lsp-client/architecture.md#编辑器服务) 的版本契约。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不在-concord-进程内运行项目代码或新增原生模块) | not-satisfied | 固定 WASM runtime/grammar 的新增运行边界需要 C-005 修订，本设计不采用 | [宪法与分发边界](architecture.md#宪法与分发边界) |
| [L2](../../LIMITS.md#l2-静态命令不启动外部分析进程) | satisfied | 语法解析在进程内；调用观察只由显式分析产生 | [数据流](architecture.md#数据流) |
| [L3](../../LIMITS.md#l3-分析结果只是投影) | satisfied | 定位与依赖观察可丢弃；`check` 仅按当前源码校验关系 | [身份与复用](architecture.md#身份与复用) |
| [L4](../../LIMITS.md#l4-外部进程资源归-concord-管理) | satisfied | 不启动外部进程；WASM 仍有内存和解析预算 | [预算](architecture.md#预算) |
| [L5](../../LIMITS.md#l5-编辑器服务只读且不开网络端口) | satisfied | 共用版本化 overlay 与请求拒绝规则 | [编辑器服务](../lsp-client/architecture.md#编辑器服务) |
| [L6](../../LIMITS.md#l6-typescript-代码声明保持现有规则) | satisfied | JS/TS 沿用内置编译器，符号观察不改身份 | [数据流](architecture.md#数据流) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-非-typescript-代码可以声明实现) | partial | 静态查询提供候选范围；各语言装饰器与绑定 fixture 仍是支持条件 | [绑定与配置](architecture.md#绑定与配置) |
| [G2](../../GOALS.md#g2-非-typescript-测试得到相关性判定) | partial | 文件级 import 只给正向观察，不能证明调用与完整闭包 | [数据流](architecture.md#数据流) |
| [G3](../../GOALS.md#g3-编辑器内可以看到-concord-关系) | satisfied | 共用版本化编辑器服务 | [编辑器服务](../lsp-client/architecture.md#编辑器服务) |
| [G4](../../GOALS.md#g4-新语言不修改-concord-即可接入) | not-satisfied | 新语言须随发行包添加固定 grammar/query；不载入项目代码 | [宪法与分发边界](architecture.md#宪法与分发边界) |
| [G5](../../GOALS.md#g5-分析结果可重建) | partial | 固定字节的语法解析可重现；模块路径、环境及依赖观察另需证明 | [身份与复用](architecture.md#身份与复用) |

## Entry Points

- [Architecture](architecture.md)
