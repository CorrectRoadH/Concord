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

套件 ID 唯一，目录必须是 canonical 仓库相对路径，不能重叠、逃逸或经过 symlink。`historyPath` 显式指定套件目录之外的历史/退役归档；current 关系仍只在真实测试声明旁的注释。测试身份由 native 文件、声明文件与静态名称派生；测试支持文件通过 `@test-file` 关联 native 文件。

不读取 Nx metadata，也没有固定 e2e 目录、host/provider 分类或 pr/main/nightly/release 通道。Concord 规定声明与证明的含义，项目决定用什么工具、在哪里和何时执行。

## 按需原生能力

host 是可选的可信本地模块，当前 Spec 为 `concord.repository-host/v2`，声明 repositoryRoot 和 `caseIdentity: "concord.case-contracts/v1"`。仅请求原生能力时加载，并核对 worktree 与锁定安装 engine 身份；静态列表、trace、help 与 Web 不加载 host。

### 进程 adapter

新接入使用与 host 互斥的可选 `adapter`；模块 host 只服务既有消费者。两者是同一治理配置的两种 transport，不产生新的 policy、关系来源或发布域。消费者 runner 不安装或 import Concord 库，需要治理算法时调用公开 engine 命令。

```ts
interface RepositoryAdapter {
  argv: [string, ...string[]];
  implementationFiles: [string, ...string[]];
  implementationRoots: string[];
  envNames: string[];
  timeoutMs?: number;      // 默认 30 分钟，最大 60 分钟
  responseBytes?: number;  // 单请求 stdout 默认且最大 32 MiB
}
```

实现文件与目录是仓库相对路径，拒绝逃逸与 symlink；argv 中的入口脚本与 loader 必须在实现集合内，否则拒绝。adapter 只收到 `envNames` 白名单中的环境变量，不接受 `GIT_*`、`NODE_TEST_CONTEXT` 或 `NODE_OPTIONS`；秘密值不进入请求或诊断。stderr 最多 1 MiB，只作诊断。没有可观察 POSIX 进程组的平台拒绝进程 transport，返回具名错误 `RepositoryAdapterUnsupportedPlatform`，不启动 adapter。

每次请求启动一个进程，shell=false，cwd 为消费者 Git 根；stdin 与 stdout 各一个 `concord.repository-adapter/v1` JSON：

```ts
interface Request {
  format: 'concord.repository-adapter/v1';
  requestId: string; root: string;
  engine: { argv: [string, ...string[]]; implementationDigest: string };
  processGroup: { leaderPid: number };
  op: 'collect-repo' | 'collect-workspace' | 'read-inventory' | 'read-red' | 'read-takeover';
  payload: unknown;
}
interface Response {
  format: 'concord.repository-adapter/v1';
  requestId: string; root: string; op: Request['op'];
  engineDigest: string; result: unknown;
  guards: { path: string; digest: string }[];
}
```

| op | payload | result |
| --- | --- | --- |
| collect-repo | `{suiteId, checkout}` | WorkspaceInventoryReceipt |
| collect-workspace | `{checkout}` | WorkspaceInventoryReceipt |
| read-inventory | `{inventoryId, selector}` | CaseInventoryReceipt |
| read-red | `{id}` | `{id, receipt, candidatePath}` |
| read-takeover | `{id}` | `{id, certificate, receipts: [{key, receipt}], candidatePath}` |

`payload` 与 `result` 按 op 严格解码。JSON 拒绝重复键、未知字段、非有限数、错误的 requestId、op 或 root（canonical realpath 必须相同）及尾随输出；整个 envelope 最大 32 MiB、深度 64、200000 个节点、单数组 50000 项，超出即拒绝，不截断证据。

engine argv 由 Concord 的 Node 与 entry 绝对路径生成，响应必须回显绑定的 engineDigest。read 响应的 guards 不得为空，列出本次读取的 manifest、receipt、certificate、inventory 与候选文件，路径是消费者根内无 symlink 的普通文件，同一路径 digest 相同。adapter 失败以非零退出与 stderr 返回。

`concord repo engine --json` 从 stdin 读取一个 `{format: 'concord.repository-engine/v1', requestId, op, payload}`。响应回显 format、requestId 与 op，并增加 implementationDigest 与 result；JSON 严格性与预算同上。它不加载 host、不执行 runner、不发布证据。外部调用方默认使用 PATH 中的 concord，被 Concord 启动的 adapter 使用请求中的 engine argv。

| op | payload | result |
| --- | --- | --- |
| identity | `{}` | `{implementationDigest, adapterDigest}`，未配置 adapter 时 adapterDigest 为 null |
| suite | `{file}` | 当前配置中唯一的 suite `{id, root}` |
| source / source-validate | `{selector}` / `{value}` | 当前或严格校验后的 RepositorySourceIdentityV4 |
| same-source | `{left, right}` | 两侧先经 source 校验，返回 `{same: boolean}` |
| projection | `{directory, suiteRoot}` | 消费者自有执行副本的 SourceProjectionV3，不构成沙箱授权 |
| declarations | `{file, source}` | `{annotated, supported}`，只解析传入字节，保留完整关系字段 |
| case-id | `{nativePath, declarationPath, title}` | Concord 派生的 caseId |
| inventory | `{kind, action, value}` | case 或 workspace inventory 的 sign 或 validate，不推断观察成功 |
| preview | `{value}` | 校验后的公开 ChangePreview |
| receipt / certificate | `{action, value}` | NativeCaseReceipt / NativeReliabilityCertificate 的 sign 或 validate；sign 输入不含摘要字段 |

签名只是完整性摘要，不表示执行成功；正式当前性、epoch、矩阵与候选判断在关系发布与 fixed 前完成。消费者可以声明 wire DTO 与严格 decoder，但不复制 case identity、投影或签名算法，也不把布尔值当作验证成功。

adapter 错误为 `RepositoryAdapterInvalid`、`RepositoryAdapterFailed`、`RepositoryAdapterChanged` 与 `RepositoryAdapterCleanupUnknown`。engine 请求无效为 `RepositoryEngineRequestInvalid`，治理错误保留原代码。静态命令不因缺少 adapter 失败；`memory check` 在 unavailable 说明中保留能力原因并输出其它可读记录。

进程组所有权、锁外捕获与本地身份核验见[治理边界](feature/neutral-project-governance/architecture.md#repository-adapter)。历史证据格式、可靠性下限和 invocation 防复用不因 transport 改变，实现身份改变后 managed 结果须重新收集。

inventory 和证据读取能力分别接入，缺失能力具名拒绝对应操作。host 不提供产品 QUERY_PROTOCOL 或产品进程 Layer；执行方自己拥有 Scope、取消和清理，Concord 只接受完整清理的有效观察。

## 证据要求

`concord.native-reliability/v1` 要求原生唯一绑定、目标回归 red、单项 green、三份隔离副本、同副本连续两次、默认并行和完整 cleanup。实际执行副本身份、观察计数和 invocation 证明这些条件，不能用收据数量替代。禁止 retry、零执行、skip、启动失败、超时或信号形成有效通过证明。

red 使用真实缺陷候选；green 与六次可靠性观察使用同一修复候选。测试定义、Spec、policy、配置和 adapter 实现绑定必须一致。regression add/refresh 与 fixed 由[同一权威 validator](feature/neutral-project-governance/architecture.md#证据核验)核验。

项目要求是下限，Problem 持久化已采用的最低要求。command 级 red/green 无法从 CLI、Web 或 action 绕过可靠原生证据门槛。reopen 增加 epoch，历史 invocation 不得再用于关闭。基础 `concord test run` 仍只记录 command 证据，不声称原生覆盖或可靠性。

## 格式边界

只读取 `concord.repository/v2`；其它格式是无效输入，返回具名解码错误并保留原件。已签发的 receipts、resolution、epoch 和已使用 invocation 保留原样，不补字段、不重签，也不作为当前验证展示。

NiceEval 的 Preview、Examples、下游链接、产品文档站和 PR 编辑组合由 NiceEval 自己拥有。来源历史见 [provenance](provenance.md)，接入验收见[按 Concord 规范接入软件项目](feature/neutral-project-governance/use-case/adopt-neutral-governance.md#验收)。
