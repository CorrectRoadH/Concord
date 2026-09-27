# 来源与抽取边界

Concord 的领域规则来源于 NiceEval revision `e1c66d31115208ceaae2f5bd4d730a7abf67048d` 的仓库工程体系。Concord 移植领域规则并重建宿主边界，不整包复制产品构建、E2E runner、Testkit 或产品场景。

| 来源 | Concord 中的对应 |
|---|---|
| `packages/repo-tools/src/memory/state.ts` | Problem 的 `resolve` 与 `reopen`、Decision 与 Insight 的 `supersede`、promotion 与 retire 规则，以及独立证据等级和 Problem epoch |
| `packages/repo-tools/src/docs/trace/ref.ts` | canonical repo-relative reference 与 Markdown anchor 校验 |
| `packages/e2e-runner/src/owned-process.ts` | Effect Scope 拥有 POSIX 进程组及 TERM、grace、KILL 收尾机制 |
| `packages/repo-tools/src/docs/trace/compiler.ts` | 正向归属与动态反查；扫描范围和 schema 由 Concord 定义 |
| `packages/repo-tools/src/docs/trace/relation-mutation.ts` | preimage、journal、原子写入与恢复模型；owner 存储不依赖来源目录或协议 |
| Feature、Use Case、Design、Research 领域 | Concord 拥有的通用文档模型、模板与具名命令 |
| 测试关系与 planner | 当前唯一身份、来源归属和显式退役；源码标记拥有 current 关系，Git 保存测试演进，命令证据拥有独立 scope |
| PR editor | 本地审阅中关联契约、测试与 Memory；使用 Concord 审阅格式 |
| Issue 领域 | 本地 Observation 与 Memory 关联，不表示远端工作项状态 |
| `lint/docs/writing.ts` | Markdown 与 MDX 写作检查；术语由 `concord.concepts/v1` 定义，政策使用 `concord.writing/v2` |
| `docs/writing-rules.json` | init 写作预设中的通用可读性规则：句长 140、段长 320，以及含糊表达的替换建议和理由 |

随包 `templates/` 的文档体裁对应 NiceEval 的 feature-design、design-decision、research 与 engineering 模板。它们保留问题、目标、约束、候选、架构、生命周期与验收的写作分工，不包含 NiceEval 专属命令、Sandbox 和判分要求。通用模式使用 `concord.templates/v1` manifest。

## 不进入 Concord 的内容

产品构建与部署、Preview、Examples、下游领域、站点、PR 组合、Mintlify、Netlify 与产品 E2E 编排由消费者拥有。产品专属词库、API 规则与站点政策不进入写作预设。NiceEval 的研究主题与工程文档属于 NiceEval 消费仓库。

## 运行时独立

发布包不依赖来源 checkout。运行时 import、模板、schema 与 Agent 指引都由 Concord 提供，写作预设随 Concord 分发，不在运行时读取来源仓库。

Research、Memory 与 Issue 使用 Concord 文档格式。通用命令结果称为 `command` evidence；原生可靠性由显式采用的 Concord 政策和当前证据核验，二者不能互相冒充。
