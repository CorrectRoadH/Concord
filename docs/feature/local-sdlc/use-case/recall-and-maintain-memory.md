# 检索与维护工程知识

## 用户目标

Agent 和维护者在开始工作前，要找到以前的调查结论、决策和经验，并在工作中更新它们。

Memory 保存可复用知识与不需要 Design 的决策，Issue 跟踪缺陷与待调查的观察，Spec 声明目标、行为与约束。三者不复制同一事实。

## 起始状态

- 项目已经初始化，Memory 位于仓库的 `memory/` 目录。

## 完整路径

新增命令的示例为预期输出。

1. 列出全部 Memory。 {#index}

   ```sh
   concord --json list memory
   ```

   ```json
   {"operation":"list","documents":[{"path":"memory/sku-merge.md","title":"按 SKU 合并购物车条目","digest":"sha256:28951a...","type":"insight","status":"current"}]}
   ```

2. 按关键词检索。 {#recall}

   ```sh
   concord memory search "sku 合并"
   ```

   ```text
   memory search
   memory/sku-merge.md — 按 SKU 合并购物车条目
     insight: current
     同一 SKU 的条目在写入前合并，数量累加。
   ```

   查询按空白拆成词项。每个词项不区分大小写地匹配标题或正文，全部词项都命中的记录才返回，词项顺序不影响结果。人读输出列出标题、类型、状态和含首个命中词项的正文片段。`--json` 返回完整正文与 `digest`。`issue search` 使用同一规则。

3. 新建记录。 {#add}

   ```sh
   concord new memory sku-merge --type insight
   ```

   命令按模板创建 `memory/sku-merge.md`，`status` 为 captured。也可以直接创建该文件，frontmatter 只写非空字段，正文以唯一的一级标题开头。

4. 修改正文与 frontmatter。 {#edit}

   直接编辑 `memory/sku-merge.md`。字段与取值见[领域与数据所有权](../library.md#memory)。

5. 用命令执行生命周期变化。 {#lifecycle}

   - `memory confirm <m>` 把 captured 的 decision 或 insight 改为 current。
   - `memory replace <m> --by <新记录>` 把记录改为 superseded 并写入 `supersededBy`。
   - `memory link <m>` 增加 `supports` 或 `amends` 关系。

   命令写入的内容与直接编辑相同，并在写入前校验转换与关系目标。

## 结果

`list memory` 与 `memory search` 只读，不写文件。`memory search` 返回记录原文与摘要。

`check` 校验每条 Memory 的当前状态：`type` 与 `status` 取值合法，note 只能是 captured，`supports` 指向存在的当前 Spec 或锚点，`amends` 指向品味的条款与款，`supersededBy` 指向存在的 Memory。

| 错误 | 触发条件 |
| --- | --- |
| `InvalidInput` | 查询为空：`recall/search query must be non-empty` |
| 具名拒绝 | 短选择器匹配多条记录，需要改用完整路径 |
| 具名拒绝 | 命令要求的状态转换不合法，例如 activate 一条 note |

`list memory` 与 `memory search` 读取 `memory/` 的全部记录。其中有坏记录或未完成的写入时，查询失败，不返回部分结果。

## 规则

- 不维护 `INDEX.md` 一类的人工索引；检索用 `memory search`，列表由 `list memory` 派生。
- 反向关系不写进 Memory，由 trace 派生。
- `memory search` 是本地确定性的文本匹配，不调用模型或远端服务，不做向量或语义检索。
- 按完整路径读取时，只检查目标记录。按短选择器读取时，先读取全部候选，唯一匹配才返回。集合不完整或有歧义时拒绝，这样不会漏看一个解码失败的同名记录。

`init` 生成的 `AGENTS.md` 区块、`docs/concord.md` 与随包 skill 都把 Agent 引到这些命令。

## Spec 来源

- 读取范围与失败边界：[架构](../architecture.md#操作依赖)
- Memory 的字段：[领域与数据所有权](../library.md#memory)
