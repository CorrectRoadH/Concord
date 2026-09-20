# 高级测试治理

`concord repo` 提供声明式测试套件、源码关系、原生证据与可靠性核验。它采用 Concord 文档与 Memory 模型，执行策略由消费项目拥有；不是某个产品仓库工具的别名。

## 接入规范

消费 Git worktree 显式声明 `concord.repository.json`，例如：

```json
{
  "format": "concord.repository/v2",
  "suites": [{ "id": "acceptance", "root": "tests/acceptance" }],
  "historyPath": "tests/history.ts",
  "policy": "concord.native-reliability/v1",
  "host": "tools/native-host.ts"
}
```

套件 ID 唯一，目录必须是 canonical 仓库相对路径，不能重叠、逃逸或经过 symlink。`historyPath` 显式指定套件目录之外的历史/退役归档；current 关系仍只在真实测试声明旁的注释。测试身份由 native 文件、声明文件与静态名称派生；helper 通过 `@test-file` 关联 native 文件。

不读取 Nx metadata，也没有固定 e2e 目录、host/provider 分类或 pr/main/nightly/release 通道。Concord 规定声明与证明的含义，项目决定用什么工具、在哪里和何时执行。

## 按需原生能力

host 是可选的可信本地模块，当前契约为 `concord.repository-host/v2`，声明 repositoryRoot 和 `caseIdentity: "concord.case-contracts/v1"`。仅请求原生能力时加载，并核对 worktree 与锁定安装 engine 身份；静态列表、trace、help 与 Web 不加载 host。

inventory 和证据读取能力分别接入，缺失能力具名拒绝对应操作。host 不提供产品 QUERY_PROTOCOL 或产品进程 Layer；执行方自己拥有 Scope、取消和清理，Concord 只接受完整清理的有效观察。

## 证据要求

`concord.native-reliability/v1` 要求原生唯一绑定、目标回归 red、单项 green、三份隔离副本、同副本连续两次、默认并行和完整 cleanup。实际执行副本身份、观察计数和 invocation 证明这些条件，不能用收据数量替代。禁止 retry、零执行、skip、启动失败、超时或信号形成有效通过证明。

red 使用真实缺陷候选；green 与六次可靠性观察使用同一修复候选。测试定义、契约、policy、配置和 adapter 实现绑定必须一致。regression add/refresh 与 fixed 由同一权威 validator 核验。

项目要求是下限，Problem 持久化已采用的最低要求。command 级 red/green 无法从 CLI、Web 或 action 绕过可靠原生证据门槛。reopen 增加 epoch，历史 invocation 不得再用于关闭。基础 `concord test run` 仍只记录 command 证据，不声称原生覆盖或可靠性。

## 迁移与历史

v1 配置与旧协调现场须通过显式离线迁移切换。旧、新写入器停写，核对锁和未完成事务后切换配置、入口和安装依赖；未知前像拒绝覆盖，中断保留恢复现场。旧 receipts、resolution、epoch 和已使用 invocation 保留，不补字段、不重签、不宣称是当前验证。

NiceEval 的 Preview、Examples、下游链接、产品文档站和 PR 编辑组合由 NiceEval 自己拥有。来源历史见 [provenance](provenance.md)，当前设计与验收要求见 [中立治理裁决](design/neutral-project-governance/README.md)。
