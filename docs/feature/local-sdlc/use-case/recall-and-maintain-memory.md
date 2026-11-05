# 检索与维护工程知识

## 用户目标

Agent 和维护者在开始工作前，要找到以前开发中积累的经验：测量结论、根因、踩过的坑和做过的取舍，并在经验过时时改写或删掉它。

Memory 只保存可复用的经验，Issue 只保存还要处理的问题，Spec 声明目标、行为与约束。三者不复制同一事实，历史由 Git 保存。

## 起始状态

- 项目已经初始化，Memory 位于仓库的 `memory/` 目录。

## 完整路径

新增命令的示例为预期输出。

1. 列出全部 Memory。 {#index}

   ```sh
   concord --json list memory
   ```

   ```json
   {"operation":"list","documents":[{"path":"memory/sku-merge.md","title":"按 SKU 合并购物车条目","digest":"sha256:28951a..."}]}
   ```

2. 按关键词检索。 {#recall}

   ```sh
   concord memory search "sku 合并"
   ```

   ```text
   memory search
   memory/sku-merge.md — 按 SKU 合并购物车条目
     同一 SKU 的条目在写入前合并，数量累加。
   ```

   查询按空白拆成词项。每个词项不区分大小写地匹配标题或正文，全部词项都命中的记录才返回，词项顺序不影响结果。人读输出列出标题和含首个命中词项的正文片段。`--json` 返回完整正文与 `digest`。`issue search` 使用同一规则。

3. 新建记录。 {#add}

   ```sh
   concord new memory sku-merge
   ```

   命令按模板创建 `memory/sku-merge.md`。也可以直接创建该文件，正文以唯一的一级标题开头。

4. 修改正文与 frontmatter。 {#edit}

   直接编辑 `memory/sku-merge.md`。字段与取值见[领域与数据所有权](../format.md#memory)。

5. 经验过时就改写或删除。 {#lifecycle}

   直接改写正文，或删除文件；以前的内容从 Git 历史查。`memory link <m> <spec>` 增加一条 `supports` 关系，等同于直接编辑 frontmatter。

## 结果

`list memory` 与 `memory search` 只读，不写文件。`memory search` 返回记录原文与摘要。

`check` 校验每条 Memory 的 `supports` 指向存在的 Spec 或锚点。

| 错误 | 触发条件 |
| --- | --- |
| `InvalidInput` | 查询为空：`recall/search query must be non-empty` |
| 具名拒绝 | 短选择器匹配多条记录，需要改用完整路径 |

`list memory` 与 `memory search` 读取 `memory/` 的全部记录。其中有坏记录或未完成的写入时，查询失败，不返回部分结果。

## 规则

- 不维护 `INDEX.md` 一类的人工索引；检索用 `memory search`，列表由 `list memory` 派生。
- 反向关系不写进 Memory，由 trace 派生。
- `memory search` 是本地确定性的文本匹配，不调用模型或远端服务，不做向量或语义检索。
- 按完整路径读取时，只检查目标记录。按短选择器读取时，先读取全部候选，唯一匹配才返回。集合不完整或有歧义时拒绝，这样不会漏看一个解码失败的同名记录。

`init` 生成的 `AGENTS.md` 区块与随包 skill 都把 Agent 引到这些命令。

## Spec 来源

- 读取范围与失败边界：[架构](../architecture.md#操作依赖)
- Memory 的字段：[领域与数据所有权](../format.md#memory)
