# 文档写作检查的实现

行为见 [README](README.md) 与[文件格式与作用域](policy.md)；本页只声明实现边界。

## Entity Ownership

| 实体 | Owner |
| --- | --- |
| 术语定义、imports、弃用名 | 所在目录的 concepts.md |
| 禁词、阈值、词表、开关与豁免 | 所在目录的 concord-writing.json |
| 合成后的有效政策与叶子来源 | 每次检查从来源派生，不持久保存 |
| 编译后的匹配器 | 进程内按有效政策摘要复用 |
| 写作 findings 缓存 | HawDB `query_cache` 中 `writing:` 命名空间的可丢弃派生值 |

## Data Flow

1. 在同一仓库快照中读取配置、全部政策与 catalog 的成员和原文，以及选中的 Markdown 与 MDX，严格解码当前格式。
2. 按选中文件合成有效政策，验证跨叶约束与资源上限。
3. 统一剔除步骤标记后，分别建立 legacy 与 controlled 视图；两条路径共用步骤标记识别，不另建 anchor 解析器。
4. 逐块分句、计数、匹配，finding 保留原始位置、实际计数、阈值、语言策略与来源。
5. 复核全部输入字节与成员集合，变化时返回 `WritingInputsChanged`，不发布陈旧结果。

输入摘要包含配置、全部政策与 catalog 原文、文档成员与字节以及解析器版本标识。解析或抽取语义改变时更新版本标识，使旧缓存失效。

## Invariants

1. 缓存只省略重复的文本分析。命中前仍读取来源并严格校验政策、术语与合成预算，返回前仍复核来源字节和成员；摘要不匹配、记录损坏或缓存不可用时重新计算，失败不写入。
2. 缓存记录有独立格式版本与严格 Schema，最多 10000 项 findings，单项不超过 8 MiB，共享该命名空间的 64 项、16 MiB 配额。句柄由 repository snapshot 管理，先于 publication lease 释放。
3. 编辑器 overlay 不读写持久缓存，未保存文本及其派生结果不进入缓存。
4. 匹配成本为 O(输入字节 + 词表字节 + 实际候选区间)，词表、候选区间与 finding 上限保证极端输入具名失败。
5. 写作检查不启动 adapter、LSP 或其它外部进程。

## Errors

| 阶段 | 失败 | 结果 |
| --- | --- | --- |
| 发布 | `set-concepts` 以外的操作写 catalog，或携带 catalog 依赖守卫 | 写入前拒绝 |
| 发布 | `set-concepts` 不是单个非空 catalog 写入，或缺少依赖守卫 | 写入前拒绝 |
| 恢复 | 依赖守卫记录的 catalog 成员或摘要与现场不同 | `RecoveryConflict`，保留现场 |

## Identity and Reuse

`set-concepts` 的 journal 保存除目标外每个已发现 catalog 的排序 canonical 路径与原文摘要，发布前与重启后的预检都核对精确成员。prepared 恢复核验非空 after 与未变的守卫，再写回精确 before；committed 恢复核验同样的守卫与 after，保留已提交字节。直接导入只指向已识别的 catalog 路径与其直接拥有的 ID。
