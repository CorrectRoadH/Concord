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
| C12 | 仓库仍有 `docs/concepts.json`，没有 `docs/concepts.md` | 不读取也不报告该文件，其中的概念不生效；作者手动改写后术语检查才生效 |
| C13 | 新仓库运行 `concord init` | 只创建 `docs/concepts.md` 随包空 catalog，不创建 `concepts.json` |
| C14 | 两个兄弟目录各定义 `term` 为 `Job` 的概念 | 不产生诊断；任一目录导入另一方后报告 `AmbiguousConceptName` |
| C15 | catalog 解释段落用行内代码写弃用名 `工单` | 不命中禁词 |
| C16 | `concepts.md` 没有 frontmatter，只有一级标题和两个概念 | 合法 catalog，`imports` 与 `deprecated` 均为空 |
| C17 | 旧版 init 生成的 `docs/concepts.md` 含 `## Shared language`，没有 `{#id}` | 返回 `InvalidConceptCatalog`；作者手动改写为 catalog 结构 |
| C18 | frontmatter 含 `format` 或其它未声明字段 | 返回 `InvalidConceptCatalog` |
