# 从 NiceEval 独立出来的边界

Concord 来源于 NiceEval revision `e1c66d31115208ceaae2f5bd4d730a7abf67048d` 的仓库工程体系。
目标领域的原始 import 闭包约为 70 个 TypeScript 文件、13,132 行；保留原有测试执行还会拉入 E2E runner、Testkit 与产品场景。
因此独立化采用领域规则移植和宿主边界重建，不整包复制。

| 来源 | Concord 中的处理 |
|---|---|
| `packages/repo-tools/src/memory/state.ts` | 移植 Problem resolve/reopen、Decision/Insight supersede、promotion/retire 规则，加入独立证据等级和 Problem epoch |
| `packages/repo-tools/src/docs/trace/ref.ts` | 移植 canonical repo-relative reference 与 Markdown anchor 校验 |
| `packages/e2e-runner/src/owned-process.ts` | 复用 Effect Scope 拥有 POSIX 进程组及 TERM/grace/KILL 收尾机制，替换产品命名 |
| `packages/repo-tools/src/docs/trace/compiler.ts` | 保留正向归属、动态反查思想；扫描范围和 schema 由 Concord 重建 |
| `packages/repo-tools/src/docs/trace/relation-mutation.ts` | 保留 preimage、journal、原子写入与恢复模型；独立存储 owner 不依赖 NiceEval 目录或协议 |
| Feature / Use Case / Design / Research 领域 | 由 Concord 拥有通用文档模型、模板与具名命令 |
| Test sidecar 与 planner | 保留当前唯一身份、来源归属和显式退役原则；注释拥有 current 关系，Git 保存测试演进；命令证据拥有独立的 scope |
| PR editor | 保留本地审阅中关联契约、测试与 Memory 的目标；使用 Concord 审阅格式 |
| Issue 领域 | 提供本地 Observation 草稿与 Memory 关联，不冒充远端 GitHub 工作项状态 |

Repository profile 迁入 NiceEval 的仓库工具模块；NiceEval 的旧源码位置只转出 Concord 发布包。Research、Memory、Issue 统一采用 Concord 当前文档格式，旧文件通过一次性迁移保留正文、来源及历史，不提供旧 owner 兼容运行时。Profile 当前测试关系位于真实声明注释，原始 history/tombstone 保留在注释归档；旧 evidence 不改写，历史处理声明保存为未验证 attestation，新正式证据使用当前 v2 gate。

产品专属 Nx E2E discovery、candidate/Testkit injection、native runner inventory 与 formal red/green/takeover 执行仍由消费仓库 host 拥有。Repository profile 托管原有 Mint、Preview、Examples 和下游领域，按消费仓库配置和素材工作。Host 的 TypeScript 声明快照只定义接口，不包含 runner 实现。
通用命令结果称为 `command` evidence，不继承 NiceEval 的 formal E2E、覆盖率或可靠性矩阵承诺。

本地发布包不依赖原始 checkout。所有运行时 import、模板、schema 与 Agent 指引都由 Concord 自己提供。

随包 `templates/` 的文档体裁提取自 NiceEval `docs/_template/feature-design`、`design-decision`、`research` 和 `docs/engineering/_template`：保留问题、目标、约束、候选、架构、生命周期与验收的写作分工，移除 NiceEval 专属命令、Sandbox 和判分要求。通用模式使用独立的 `concord.templates/v1` manifest；它不加载 repository profile 的 `niceeval.docs-template/v1` 模板或复制其测试 sidecar。

Research 模板后来按自由研究契约收敛为标题，来源、观察日期、章节和附页均不强制。历史 NiceEval 主题仍属于 NiceEval 消费仓库；离线目录迁移只补齐其当前格式与路径，不复制进 Concord 自身文档。
