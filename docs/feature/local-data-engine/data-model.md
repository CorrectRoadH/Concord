# Memory 与 Issue 的检索数据

本页定义[检索投影](concepts.md#knowledge-search-projection)在 HawDB 中的结构。来源核对、查询与资源释放由[检索架构](architecture.md#knowledge-search)拥有。全部结构位于已有 `cache.hawdb`，由工作区服务持有；它们可整体删除重建，不拥有文件、Issue 生命周期或发布恢复材料。

## 文档节点 {#documents}

每个当前文件对应一个节点。Memory 使用 `MemorySearchDocument` 标签，Issue 使用 `IssueSearchDocument` 标签；种类由标签确定，不在同一节点重复保存。两个标签分别创建路径唯一约束、路径属性索引与 `searchText` 全文属性索引。节点没有关系边，不用图遍历回答文本查询。

| 属性 | HawDB 类型 | 约束与含义 |
| --- | --- | --- |
| `path` | String | 必填，标签内唯一；经过路径安全校验的 canonical 仓库相对路径 |
| `id` | String | 必填，由当前文档路径派生的短选择器，不作为主键 |
| `title` | String | 必填，保留来源标题 |
| `body` | String | 必填，保留来源正文，包括空正文 |
| `digest` | String | 必填，完整来源字节的摘要；格式与 `DocumentRecord.digest` 相同 |
| `searchText` | String | 必填，将标题、换行、正文连接后统一转换小写的文本 |
| `provider` | String | 仅 Issue 必填，取当前解析记录的 provider；没有远端来源时为 `local`，Memory 不存此属性 |

HawDB 的节点内部 ID 不跨原生边界作为文档身份。重复路径、缺失字段、错误类型或错误 provider 均拒绝该批写入；TypeScript 在原生输入和输出边界严格 Schema 解码。所有必填属性创建 `ASSERT EXISTS` 约束，路径另有 `ASSERT UNIQUE` 约束。值类型和 provider 的领域约束由 Schema 校验。

以 Memory 为例，以下是引擎支持的 DDL 形状；Issue 使用相同结构和自己的固定标签：

```cypher
CREATE INDEX ON :MemorySearchDocument(path)
CREATE CONSTRAINT ON :MemorySearchDocument(path) ASSERT UNIQUE
CREATE CONSTRAINT ON :MemorySearchDocument(path) ASSERT EXISTS
CREATE FULLTEXT INDEX ON :MemorySearchDocument(searchText)
```

其余必填属性各建一个存在约束。查询值、路径与文档属性通过参数传入；标签和 DDL 由程序固定，不接受调用者提供的 Cypher。

## 文本身份 {#normalization}

写入端对 `${title}\n${body}` 执行与现有搜索相同的 JavaScript `toLocaleLowerCase()`。查询端精确采用 `query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)`；不执行词干化、Unicode 规范化、标点删除或同义词扩展。大小写转换必须使用同一服务运行时和 locale，不能让 Rust 与 TypeScript 各自决定归一化。

`definitionDigest` 覆盖检索结构版本、文档解析器身份、归一化算法、Bun / Unicode 运行时身份和实际 locale。任一项改变，整个对应集合失效。HawDB 的 n-gram 只用于候选筛选，最终精确谓词对已经归一化的原字符串执行；不以分词结果替代搜索语义。无可用 gram 的合法词项由[引擎精确扫描](architecture.md#knowledge-search-query)处理，候选始终是精确命中的超集。

## 代次节点 {#generation}

每种文档只有一个 `KnowledgeSearchGeneration` 节点，`kind` 取 `memory` 或 `issue`，有唯一与存在约束。其余属性均必填：

| 属性 | HawDB 类型 | 含义 |
| --- | --- | --- |
| `kind` | String | 目标来源集合与标签的固定对应 |
| `generation` | String | 本次完整更新的不可复用标识 |
| `definitionDigest` | String | 结构、解析与归一化身份 |
| `sourceDigest` | String | 按路径排序的完整 `(path, digest)` 集合摘要，包含空集合 |
| `documentCount` | Integer | 非负，须与这一种类的文档节点数相符 |

代次节点只代表完整集合。首次构建在一个写事务内创建全部文档与代次；增量更新在一个写事务内替换变化节点、删除消失节点并替换代次。更新使用路径定位；路径改名不保留旧身份。修改 `searchText` 时由 HawDB 在相同提交中维护索引，不能单独提交文档再异步提交其搜索索引。

更新全部在一次原生调用内完成，事务内部可以分批执行语句，但只能在全部语句成功后提交事务。完整变更集和内部语句批次分别遵守[资源预算](architecture.md#资源预算)；不能通过跨调用持有事务或逐批提交绕过上限。构建或更新失败回滚该事务；旧代次可以留在磁盘，却不能在来源已变时作为当前结果返回。没有代次、身份不符或节点计数不符都视为不可用集合，禁止从存在的部分节点推断完整结果。

一次原生检索调用在内部持有同一个数据库读事务，读取代次、筛选文档和取得正文；内部分批共用快照、引擎路径顺序与累计预算，调用返回前释放事务。返回的代次必须与应用层本次来源观察一致；数据库快照不代替文件核验。

## 来源观察与生命周期 {#source-observations}

文件身份、最近核验的摘要、目录集合与来源诊断复用服务的增量工作区图，不再持久化一份独立文件登记表。图中的记录把本次来源视图与 `generation` 关联；只有关联仍有效时才能复用数据库内容。没有已核验来源记录时，数据库里的 `digest` 不能自行证明文件当前性。

节点与代次由工作区服务在现有写入调度中更新。解析线程没有数据库句柄，CLI、Web、LSP 与测试 runner 不取得持久写入权。内存降级使用同一结构；clear、句柄关闭、重建与取消遵守[资源生命周期](architecture.md#knowledge-search-lifecycle)。

## 容量与淘汰 {#capacity}

两个标签与代次合计最多 20000 个文档、64 MiB 逻辑数据，计入路径、属性名、原文、归一化文本和代次，不能只计算原文。持久存储共享[缓存预算](architecture.md#资源预算)，内存降级单独占用最多 64 MiB 逻辑数据；这些不是进程 RSS 上限。

容量不足时按 Memory 或 Issue 的整个集合失效，删除该集合的代次与文档，并让本次查询使用完整来源扫描；不能逐条淘汰后继续把剩余索引当作全集。失败或取消的清理不能留下可用代次指向部分集合。单文档、单批输入、原生输出、索引页与执行内存还须分别满足引擎资源准入，所有读取共享查询的累计预算。
