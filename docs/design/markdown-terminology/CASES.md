# 单一写法的术语由 Markdown 拥有

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | `docs/concepts.md` 定义 `## Issue {#issue}`，frontmatter 弃用 `观察`；某 Feature 正文写「观察」 | `docs check` 报告禁词，建议写法为 `Issue`，来源为 `docs/concepts.md#issue` |
| C2 | 正文只写 `Issue` | 计为使用，不产生 `unusedConcept` |
| C3 | 正文写 `[Memory](../../concepts.md#memory)` | 不产生 finding；把 fragment 改为 `#memo` 后 `check` 报告 `AnchorNotFound`，带路径与行号 |
| C4 | 概念 `memory` 的解释段落写在定义之后，含链接与三级标题 | 结构合法；解释不计为使用；`show` 的 `definition` 只含定义段落 |
| C5 | `concepts set` 提交含注释性空行与特定换行的正文 | 保存后的文件字节与提交内容相同 |
| C6 | 两个写者基于同一 digest 先后 set | 后者返回 `PreimageChanged`，Web 保留草稿 |
| C7 | 二级标题缺少 `{#id}`、标题含行内代码、标题后紧跟列表 | 各返回 `InvalidConceptCatalog`，消息带行号与原因 |
| C8 | `deprecated` 的键指向不存在的 ID，或弃用名等于本文件某个 `term` | 返回 `InvalidConceptCatalog` |
| C9 | 一个 catalog `imports` 了 `docs/feature/a/concepts.md#job`，作者 set 时删除该概念 | 返回 `ConceptInUse` 并列出引用者 |
| C10 | 正文链接指向的概念被删除，无 catalog 导入它 | 写入成功；`check` 报告 `AnchorNotFound` |
| C11 | 用 `author set` 或 `feature page set` 改写某个 `concepts.md` | 返回 `ManagedConceptCatalog`，不写入 |
| C12 | 仓库仍有 `docs/concepts.json` | `concepts index`、`docs check`、`check` 返回 `ConceptMigrationRequired`，`complete` 为 false |
| C13 | `concepts migrate --draft --language zh` | 不写文件；输出覆盖全部 v1 catalog，`unplaced` 列出 en 名称与 aliases |
| C14 | 迁移输入漏掉一个 v1 catalog，或某个 `legacyDigest` 过期 | 拒绝迁移，不写任何文件 |
| C15 | 迁移在写完第一个 `concepts.md` 后中断 | 普通命令返回 `RecoveryRequired`；`concord recover` 按前后像完成或回退；v1 成员被外部修改时返回 `RecoveryConflict` |
| C16 | 迁移完成后再次执行同一输入 | v1 成员为空，输入覆盖校验失败；空输入返回空 `changedPaths` |
| C17 | 新仓库运行 `concord init` | 只创建 `docs/concepts.md` 随包空 catalog，不创建 `concepts.json` |
| C18 | 两个兄弟目录各定义 `term` 为 `Job` 的概念 | 不产生诊断；任一目录导入另一方后报告 `AmbiguousConceptName` |
| C19 | catalog 解释段落用行内代码写弃用名 `工单` | 不命中禁词 |
