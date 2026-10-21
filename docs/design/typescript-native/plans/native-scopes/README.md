# 受限编译器作用域

## Problem

原生编译器有进程和远端 AST 生命周期，必须显式管理，不能把模块全局 namespace 当作永久无资源对象。

## Core Mental Model

`src/typescript-host.ts` 拥有 `withTypeScript` 同步作用域与 `withTypeScriptSource` 解析入口。前者按同步调用栈惰性创建一个 `typescript/sync` API，嵌套调用复用，最外层 finally 关闭；不得返回 Promise 或让 API、AST、snapshot、program 逃逸作用域。缓存只保存已转换的领域值，不保存远端节点。同步 API 本身不支持抢占取消；编辑器任务取消与 shutdown 使用下述 owned process group。纯 AST 操作从 `typescript/ast` 引入，不使用根入口兼容对象。

`withTypeScriptSource(path, text, callback)` 在作用域内以仅包含当前文件的完整虚拟文件系统建立 snapshot/program，向 callback 提供 SourceFile 和真实 syntactic diagnostics。finally 释放 snapshot，再关闭外层 API。纯注释路径可采用 retained source lease，但同样在 callback 后释放。批量扫描的外层同步循环可复用 API，不跨 await 保存作用域。

API 固定 `runExternalCode: false`，使用包内可执行文件，不接受项目路径覆盖。默认文件系统回调拒绝读写，允许的文件由完整 request filesystem 提供；不使用回落至宿主的 layer。p5 的 lib 预捕获自固定编译器包并进入完整 VFS，p5 声明来自发行包；其它文件均来自已有受限捕获图。原生 TypeScript 是固定第三方工具依赖，不新增 Concord 自有原生实现，不改变 C-005 的源码语言例外。

配置解析与代码扫描将 TS 诊断映射回既有 InvalidConfigSyntax/CodeParseError，依赖与 p5 保留原具名边界；编译器不可用统一 TypeScriptUnavailable，不伪造解析成功。源位置按 UTF-16，类型 API 的 `text`/`pos` 诊断字段显式转换。

依赖分析使用独立 `withTypeScriptFiles(files, callback)` 作用域，其 host callbacks 只返回已捕获的完整文件集合与派生目录，不回落至磁盘；由该 API 读取和解析捕获 tsconfig（包括捕获集合内的 extends）。随后以相同捕获文件建立完整 snapshot，依据 compiler options 创建 模块解析器。该作用域不复用其它 host 的 API。使用 containing directory 和 snapshot 解析，只返回捕获集合中的路径；失败仍产生既有 gap。不读取宿主 tsconfig extends 或 node_modules 来补全缺失输入。

p5 将捕获图、资源 ambient 声明、受信 p5 类型组成完整虚拟文件系统，建立 snapshot 前递归扫描静态 import/export、import type、ImportTypeNode 与三斜线相对类型路径，将遗漏的类型文件通过既有 captureType、预算与路径验证加入图。遍历以已访问路径终止，所有 captured 类型闭包固定后再建立 snapshot；解析期间不修改完整 VFS。模块解析器 仅使用已固定 resolutions，不提供临时宿主回落。诊断与 bundle loader 类型一致；资源导入属性不得将现有 string/dataurl/css 输出虚报为 CSSStyleSheet 或 bytes。

## Scope

构建使用原生 tsc 做完整类型检查、声明与 sourcemap 输出。Effect namespace 窄化保持启动性能，在编译后对生成 JS 做 AST 定位转换，每个 import 的替换保持原换行数（多个 namespace import 可在同一行用分号分隔）。确认 import 独占生成行后，先将 sourcemap 解码为绝对坐标，再删除改写行映射并重新编码，保留其余行映射。不得改写源文件或跳过声明检查。构建侧有正常仓库文件系统权限，运行时受限 API 不继承它。共享 host 统一管理编译器资源；构建与运行时采用同一精确版本。

MDX content mapper 是外部代码执行能力，不自动接入静态 check 或编辑器。Markdown 的 prose、steps 与 writing 语义继续由 mdast 负责；本方案不承诺用 import attributes 替代文档解析。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-bounded-authority) | satisfied | 完整虚拟输入、禁止 mapper、同步作用域 finally | 上述生命周期设计；C1–C5 为实现验收 |
| [L2](../../LIMITS.md#l2-public-delivery) | satisfied | 单一 TS 依赖、真实诊断、原输出映射 | 构建与 C6 契约 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-native-compiler) | satisfied | 精确固定 7.1.0-beta 和包内平台产物 | 官方 npm API 结构 |
| [G2](../../GOALS.md#g2-equivalent-behavior) | pending | 保留领域语义和预算，待实际验收 | C1–C6 与既有性能方法 |

## Editor computation owner

编辑器每个 Job 使用一个包内 Node 子进程，由现有 OwnedProcess 服务持有独立进程组。调用入口固定为发行包的 editor-worker.js，参数固定 Node 256 MiB heap 上限；项目配置不得替换 executable、入口或参数。编译器子进程继承该 Job 的进程组，取消、超时、输出超限、EOF 和 shutdown 使用同一 owned group 终结与确认流程，不直接终止持有编译器的 Worker 线程。外部 language server、adapter、项目模块和 content mapper 仍不执行。

Job 通过 stdin 单个 JSON 传入，子进程严格解码 Job；结果通过 stdout 单个 JSON 返回并严格解码 WorkerReply。父进程序列化后与子进程分块读取时均执行现有 64 MiB input 上限，子进程使用严格 UTF-8 解码；超过 wire 上限返回 EditorBudgetExceeded，不启动额外任务；输出含 stdout/stderr 共同受现有 8 MiB 上限约束，执行受 30 秒上限约束。

每个 Job 单独创建 OwnedProcess service 和 Effect Scope，在该 Job 的 Effect.runPromise 内显式提供服务；不能依赖 serveEditor 外层的 provide 传播到独立运行时。Scope 包住运行与结果解析，释放时等待进程终结。在 Scope 最终收尾之后，不可中断的收尾阶段读取该 service 的 cleanupResults，检查 processGroupOwned、groupCleanup.owned、checked 和 gone 均为 true；activeCount 为零不代表清理成功。

启动前拒绝不支持的平台或输入预算时没有进程；已进入运行的 Job 若缺少清理记录，也视为未知。每个 Job 收尾后释放 service，避免长期持有完整 stdout/stderr。

成功响应先满足正常退出、零信号、未超时、未取消和上述清理核验，再验证来源和版本。清理结论通过独立回调进入会话级失败状态，不受 tasks 成员、取消响应或 ended guard 影响。未知或失败清理永久保留 EditorTaskFailed，停止新计算及诊断调度，不发布该任务结果。

取消后的任务仍保留在 running 集合直到 Scope 收尾和清理结论提取完成；shutdown 等待全部 running，再检查会话状态，有失败则返回 EditorTaskFailed 而非 null。EOF、exit 和外层释放同样等待收尾，有清理失败则服务失败且退出非零。正常 RequestCancelled 回复不能覆盖清理失败。内部服务不获得来源写权限或 publication lease。

不具备 owned process group 的平台不启动该内部任务，返回 EditorTaskFailed，不能把未确认的后代清理声明为成功。此限制需要在编辑器能力文档中明确。Linux 与 macOS 使用项目已有进程组实现；跨平台扩大支持须有对应的后代回收机制。

C5 的验收增加公开编辑器取消/shutdown 的真实子进程生命周期，以及持有原生 compiler 的 Job 超时后没有活动后代；正常结束的 API、snapshot 和模块解析器 仍按词法作用域释放。Linux 已退出但待系统收割的进程沿用 OwnedProcess 的 zombie-only 分类，不作为活动运行者；不能留下挂在长期编辑器主进程上的未收割 compiler。
