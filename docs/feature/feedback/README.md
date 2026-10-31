# 多来源反馈与本地处理

维护者和 AI 将本地观察、GitHub issue、Linear issue 汇入同一反馈入口，以带角色的关系关联工程 Memory 与承接它的 Spec，并在项目中保留调查笔记和关闭结论。来源由可扩展的读取适配器提供；产品行为由 Feature 声明，修复核验的结论写在 Issue 的关闭结论中。

Web 以常驻反馈导航和右侧详情组织处理流程，导航提供搜索、来源和处理状态筛选；选择反馈后直接阅读或编辑本地正文。手机通过共享内容导航抽屉选取反馈。导入与同步在反馈入口显式操作，连接表单归项目设置。CLI 提供同样的领域操作及结构化结果，适合 AI 按需读取和处理。Use Case 继续隶属于 Feature；反馈不是另一套产品需求注册表。

- [处理来自不同来源的反馈](use-case/triage-feedback.md)
- [CLI 与 Web 用法](cli.md)
- [身份、存储与接入边界](architecture.md)
- [生命周期](architecture.md)
- [适配器接口](library.md)
- [CLI 登录态复用设计](cli-integration.md)

支持 GitHub 公共 API 实例与 Linear 公共 API，默认使用环境变量提供读取凭据。GitHub 还可在项目设置中显式选择 gh，复用运行 Concord 的机器上的 GitHub CLI 登录态，无需在项目中配置凭据；要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。连接检测与同步需明确触发；不轮询远端，Feedback 读取不修改远端 issue（远端写入只经 [`concord issue remote preview` 与 `execute`](../neutral-project-governance/use-case/mutate-remote-issue.md)），也不实现 webhook 接收和 OAuth 授权流程。两种模式的保证见[CLI 接入设计](cli-integration.md)。

- [无外部服务时管理本地观察](use-case/manage-local-observations.md)
- [来源与工程知识术语](concepts.md)

## 性能预算

按[性能验收](../../engineering/concord-self-hosting/performance.md)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `feedback/list` | 本地反馈列表 | 620ms |

## 依据的品味

- [一件事只写一次，其余推导](../../constitution.md#c-019)
- [只声称证明过的](../../constitution.md#c-021)
