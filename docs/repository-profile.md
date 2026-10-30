# 项目测试接入边界

Concord 用源码标记把测试关联到 Spec，通过配置的 `runner` 运行测试，并只按 runner 的退出码解释结果。它不登记测试套件，不签发原生 case 覆盖或正式可靠性结论（[C-004](constitution.md#c-004-1)）。

## 项目拥有

测试框架与原生 runner、执行环境与执行副本、候选产品的构建与安装、进程与容器等外部资源的清理，以及何时、在哪个通道执行哪些测试。Concord 不读取 Nx metadata，也没有固定 e2e 目录、host/provider 分类或 pr/main/nightly/release 通道。

## Concord 拥有

发现范围（默认取存在的 `test/`、`tests/`，测试在其它位置时配置 `testRoots`）、源码标记解析、稳定 case 身份、`concord test run`，以及以 fixed 关闭 Issue 前的[修复核验](constitution.md#c-004-2)。所有权划分见[治理边界](feature/neutral-project-governance/architecture.md#所有权)。

## 可靠性治理

逐 case 的原生证据、可靠性观察与政策下限不属于 Concord，需要它们的项目在自己的 CI 中实现，其结论不参与 Issue 的关闭判定。仓库中已有的治理配置与原生收据原地保留，Concord 不读取、不删除（[决策依据](design/sdd-core-model/DECISION.md)）。

NiceEval 的 Preview、Examples、下游链接、产品文档站和 PR 编辑组合由 NiceEval 自己拥有。来源历史见 [provenance](provenance.md)，接入验收见[按 Concord 规范接入软件项目](feature/neutral-project-governance/use-case/adopt-neutral-governance.md#验收)。
