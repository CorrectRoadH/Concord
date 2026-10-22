# 进程桥接架构

## 配置与职责

`concord.repository/v2` 增加可选 `adapter`，与 `host` 互斥。模块 host 只服务已有消费者；新接入使用 adapter。

这是一个治理配置的两种 transport，不产生新的 policy、关系来源或发布域。

```ts
interface RepositoryAdapter {
  argv: [string, ...string[]];
  implementationFiles: [string, ...string[]];
  implementationRoots: string[];
  envNames: string[];
  timeoutMs?: number;
  responseBytes?: number;
}
```

实现文件为仓库相对普通文件，拒绝逃逸和 symlink；实际入口脚本必须纳入。

adapter 只能读取显式环境白名单，剥离 `GIT_*` 与 `NODE_TEST_CONTEXT`；不把秘密值写进请求或诊断。

超时默认为 30 分钟，最大 60 分钟；单请求 stdin/stdout 默认且最大 32 MiB，stderr 最大 1 MiB。

此预算覆盖消费者安装与全仓收集，不改变普通原生 adapter 的短时预算。

Concord 哈希配置和完整 implementationFiles 字节。模块 host 继续校验安装引擎字节；进程 adapter 不要求消费者安装 Concord 库。

每请求通过 engine descriptor 绑定实际 CLI，引擎或 adapter 字节在调用前后变化即失败。

## 请求与响应

入口使用配置 argv，shell=false，cwd 为消费者 Git 根。每请求一个进程；stdin 与 stdout 各一个 JSON，stderr 仅诊断。

JSON 拒绝重复键、未知字段、非有限数、错误 requestId/op/root 和尾随输出。失败响应或进程异常不能返回成功数据。

```ts
interface EngineDescriptor {
  argv: [string, ...string[]];
  implementationDigest: string;
}
interface Request {
  format: 'concord.repository-adapter/v1';
  requestId: string;
  root: string;
  engine: EngineDescriptor;
  processGroup: { leaderPid: number };
  op: 'collect-repo' | 'collect-workspace'
    | 'read-inventory' | 'read-red' | 'read-takeover';
  payload: unknown;
}
interface Response {
  format: 'concord.repository-adapter/v1';
  requestId: string;
  root: string;
  op: Request['op'];
  engineDigest: string;
  result: unknown;
  guards: {path: string; digest: string}[];
}
```

`unknown` 仅表示下表的按 op 严格解码联合，不允许任意扩展字段。根路径 canonical realpath 必须相同。

engine argv 由 Concord 实际 Node 与 entry 绝对路径生成，不由消费者响应选择。engineDigest 必须回显请求绑定。

adapter 的失败以非零退出和 stderr 返回；宿主提供具名 `RepositoryAdapterFailed`，不依赖解析 stderr。

| op | payload 全字段 | result |
| --- | --- | --- |
| collect-repo | `{suiteId, checkout}` | WorkspaceInventoryReceipt |
| collect-workspace | `{checkout}` | WorkspaceInventoryReceipt |
| read-inventory | `{inventoryId, selector}` | CaseInventoryReceipt |
| read-red | `{id}` | `{id,receipt,candidatePath}` |
| read-takeover | `{id}` | `{id,certificate,receipts:[{key,receipt}],candidatePath}` |

完整字段沿用 `repository/host-types/index.d.ts`，迁入严格 transport Schema owner。

类型为 CaseInventoryReceipt、WorkspaceInventoryReceipt、NativeCaseReceipt 与 NativeReliabilityCertificate。

Map 仅在 Concord 解码后由唯一 key 数组构造。重复 key、重复 case 或格式错误拒绝；原生 findings 保留供现有 validator 判定。

candidatePath 必须经过当前已有受管证据字节与路径核验；仅拥有路径不构成候选证明。

## 公开 engine 入口

`concord repo engine --json` 从 stdin 读取一个请求。此入口不加载 host、不执行 runner、不发布证据，只运行治理算法。

请求为 `{format:'concord.repository-engine/v1',requestId,op,payload}`；响应回显 format/requestId/op，增加 implementationDigest 和 result。

遵循相同 JSON 严格性与 32 MiB 预算，具名错误写 stderr 并非零退出。

| op | payload 全字段 | result 与语义 |
| --- | --- | --- |
| identity | `{}` | `{implementationDigest,adapterDigest}`；adapterDigest 为当前配置的实现摘要，未配置 adapter 时为 null |
| suite | `{file}` | 当前配置唯一 suite `{id,root}` |
| source | `{selector}` | 当前 RepositorySourceIdentityV4 |
| source-validate | `{value}` | decodeRepositorySourceIdentityV4 严格校验后的完整身份 |
| same-source | `{left,right}` | 两侧先经 source decoder，再调用 sameRepositorySourceIdentity，返回 `{same:boolean}`，仅表示身份相等 |
| projection | `{directory,suiteRoot}` | SourceProjectionV3；实际执行副本投影 |
| declarations | `{file,source}` | `{annotated: AnnotatedCase[],supported:{title,start}[]}`；AnnotatedCase 完整保留 caseId/declarationPath/testFile/contract/contractKind/regressions/issues/title/declarationStart/annotationStart/annotationEnd/annotationRanges，复用现有 parser |
| case-id | `{nativePath,declarationPath,title}` | 按既有 deriveTestReference(nativePath,declarationPath,title) 得到的 caseId，保留 `@test-file` 测试声明文件 的声明归属 |
| inventory | `{kind:'case'|'workspace',action:'sign'|'validate',value}` | 对应 inventory；case digest 与既有 evidenceSignature 一致；workspace 摘要保持现有聚合规则，不推断观察成功 |
| preview | `{value}` | 复用 decodeChangePreview 的完整公开 ChangePreview 数据，拒绝无效输入 |
| receipt | `{action:'sign'|'validate',value}` | 严格 NativeCaseReceipt；sign 输入不含 receiptSha256 |
| certificate | `{action:'sign'|'validate',value}` | 严格 NativeReliabilityCertificate；sign 输入不含 certificateSha256 |

source 和 suite 只读当前配置和契约。declarations 只解析传入文件字节，不声称原生执行；caseId 由 Concord 派生。

projection 允许消费者显式提供自己拥有的执行副本绝对路径，沿用普通目录及 symlink 检查；该命令不是沙箱授权。

receipt/certificate 的签名只是完整性摘要。正式当前性、epoch、矩阵和候选判断仍由唯一 `validateNativeEvidence` 在关系发布与 fixed 前完成。

validate 校验结构、来源内在一致性和完整性摘要；不得接受坏签名再自动重签。

schema、签名、source identity 和声明算法在 Concord 各保留一个实现；engine 路由只组合，不复制。

消费者可以声明 wire DTO 与严格边界 decoder，但不能复制 case identity、投影、签名算法或把布尔值当验证成功。

外部 caller 默认从 PATH 找全局 concord；被 Concord 启动的 adapter 使用请求中的 engine argv，避免不同安装混用。

## 普通原生 adapter 的关系

repository adapter 可以使用 test-adapter 完成原生计划/解析，也可以继续使用已有可信 runner。

两者复用受管进程、JSON decoder 与预算机械能力。可靠性字段不塞入 `concord.native-evidence/v2`。

该方案达成库解耦；不宣称 NiceEval 已把原生 runner 全部迁入通用四操作协议。

## 错误与发布

新增 transport 错误为 `RepositoryAdapterInvalid`、`RepositoryAdapterFailed`、`RepositoryAdapterChanged`、`RepositoryAdapterCleanupUnknown`。

engine 请求失败为 `RepositoryEngineRequestInvalid` 或保留原有治理错误。静态命令不因缺 adapter 失败。

当前 memory check 在 unavailable 说明中保留 capability 原因，仍输出其他可读记录。

没有新的证据数据库。Concord 现有关系、history、Memory 与 journal 保持唯一发布 owner。

## 发布前的本地身份核验

进程配置的 managedInventoryImplementationDigest 由 Concord 本地计算，不启动 adapter。

摘要绑定当前 engine、配置原文、adapter argv、声明的全部实现文件路径与字节、执行文件字节及运行时版本。

消费者从 engine identity 取得同一 adapterDigest，用于 managed bundle；不复制摘要算法。

Concord 在 publication lease 内只重新计算本地身份，不运行外部进程。

普通模块 host 保持原有 capability 路径；进程模式不得借其回调在持锁期间执行。

source identity 的 adapterSourceDigest 绑定同一配置和实现文件集合；adapter 文件漏报属于不满足接入契约，入口脚本未声明则拒绝。

## 验证数据与观察的区别

transport 将所有 Unknown 字段限制为有限 JSON 值，深度、节点数与总字节受预算约束；source 进一步走 v4 decoder。

Schema 成功仅证明可解码，不证明真实执行。现有原生 collection、候选 attestation 和可靠性 validator 必须逐项继续运行。

engine 的 sign 入口不接受 managed ID、不写文件、不发布证据；其结果只有通过正常发布时的当前事实核验才可使用。

## 实现闭包与接入前提

implementationRoots 是非空仓库相对目录的数组；Concord 递归枚举普通文件，固定排除 node_modules 与 .git，拒绝其它 symlink、特殊文件和空根。

implementationFiles 是补充的精确普通文件；所有集合去重排序后绑定路径与字节，新增/删除文件也改变摘要。

入口 argv 中的仓库脚本必须被该集合包含；执行文件实际 realpath、字节、Node 版本也进入摘要。

NiceEval 的根固定包含 packages/e2e-runner/src 与 packages/testkit/src。

精确文件包含根 package.json、pnpm-lock.yaml、pnpm-workspace.yaml、两个 workspace package.json、runner tsconfig 与其 extends 链、实际原生 runner 配置。

仓库配置本身始终绑定，无需重复列入。原生配置用现有 suite 配置覆盖，首次迁移按当前导入审计补齐实际路径。

安装后的依赖包由 frozen-lockfile 和包管理器完整性负责；本协议不声称对任意被篡改 node_modules 自动做依赖分析。

loader 是实现的一部分：接入校验须确认当前安装的 tsx 版本与 lock 一致，将解析到的 loader 入口真实字节绑定；调用方自选 loader 或未声明的 argv 脚本失败。

CI 静态接入检查拒绝 runner 源码/所导入 workspace 实现或配置不在声明集合内；新外部依赖必须先进入 lock。

## 锁外捕获与发布快照

所有 read capability 在取得 publication lease 前执行。响应 guards 包含本次读取的 managed manifest、receipt/certificate/inventory 文件与 candidate 文件，路径是消费者根内无 symlink 的普通文件；重复路径必须同一 digest。

Concord 立即读取并核对每个 guard 的 SHA-256；read-red/read-takeover 的 candidatePath 必须在 guards 中，其内容摘要与 receipt 的 candidate.sha256 相同。

collect 响应 guards 可为空；read 响应不得为空。adapter 是受信任接入代码，完整 guards 声明属于其契约，不能将任意恶意代码视作沙箱。

锁外将严格解码的三个结果、候选摘要、guards 和本地 implementationDigest 组成只读 CapturedRegressionEvidence，并运行唯一 validateNativeEvidence。

锁内不再调用 validateRegressionEvidence 的读取流程：重验 guard 字节、本地身份、当前源码/配置、Memory epoch/已用 invocation 和 publication 前像，再将冻结输入交给同一个 validator。

用于复制与签发关系索引的对象必须正是该捕获，不能再次从 adapter 获取另一份。任一 guard/currentness 变化返回 PreimageChanged，不重签、不自动重试发布。

旧 module-host 路径保留旧接入语义；新 transport 的锁内路径无任何 child-process capability。fixed 的本地证据重验也仅使用本地 implementationDigest。

## 消费者逐项映射

NiceEval case-evidence/managed-evidence 的 receipt/certificate/source decoder、签名及 implementation 身份走 engine。

inventory 的声明、case ID 与摘要走 declarations/case-id/inventory。

red-evidence/takeover/run-repo 的 suite/source/projection 走对应 engine 操作；source 相等比较调用 same-source。禁止用 projection.digest 当完整身份摘要。现有 sameRepositorySourceIdentity 同时比较 projection、case/declaration 和 contract/configuration/adapter binding，算法仍归 Concord。

repo-tools PR 关系走 declarations 完整关系字段；Preview 用公开 view export 后再调用 engine preview 验证，消费端只持有其实际读取的 DTO。

repo-tools 的 docs/root 机械能力由 NiceEval 拥有，不包含 Concord 治理算法。concord.config.ts 改用本地最小配置形状或 CLI 运行时检查，不能为了 type-only import 保留 Concord 库。

三个 manifest 与 lock 全部移除 Concord 库依赖；静态扫描覆盖所有 packages、配置与 lint，不只 runner。

JSON 预算为完整 envelope 32 MiB、最大深度 64、最多 200000 节点、单数组最多 50000 项；超过即拒绝，不能截断证据。
