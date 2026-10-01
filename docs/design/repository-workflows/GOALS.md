# 仓库工作流贡献的目标

## G1: 单文件错误不阻断只读查询

共享工作树里一个测试源码文件的标记错误，不阻断其它 Agent 的列表、显示、检索和检查报告。错误带路径、具名代码和建议的 canonical 引用。来源：NiceEval 审查 H3。判定：C1。

## G2: 远端 Issue 写入可按契约执行

维护者能通过受管命令完成“只读 plan → 显式授权 → 一次 CAS 写入”，不必绕到 `gh` 直接写。来源：NiceEval 审查 H1 与 [C-007](../../constitution.md#c-007)。判定：C2、C3。

## G3: 本地 Issue 只有一个名字和一个写入口

同一份 `docs/issues/<id>.md` 只能由一组命令修改，help 用词一致。来源：NiceEval 审查 M1 与 [C-001](../../constitution.md#c-001)。判定：C4。

## G4: 共享工作树上的并行文档切分

Docs Work 只要求本次声明的路径干净，支持声明读集合、依赖与检查命令，finalizer 命令由项目配置。来源：NiceEval 审查 M5。判定：C5、C6。

## G5: 领域拥有命令树，宿主只组合

宿主 CLI 组合 Concord 的 Feedback、Memory、Docs Work 命令贡献，不复制 verbs、options 与 help；未知子命令给出明确错误。来源：NiceEval 审查 M2、L7。判定：C7。
