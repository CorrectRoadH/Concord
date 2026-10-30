# 工程 Memory

Memory 保存可复用的知识与不需要 Design 的决策，每条是 `memory/<id>.md` 一个文件，不复制 Spec 正文、Design 结论或测试关系。缺陷由 Issue 跟踪，见 `concord --skill feedback`。

## 字段

路径是身份，名称是正文唯一的一级标题。frontmatter 只保存推导不出的事实，字段只在非空时出现：

```yaml
type: decision         # decision、insight、note
status: current        # captured、current、superseded；note 只能是 captured
relations:
  - role: supports     # 支持一条 Spec；或 amends，指向宪法条款与款
    target: docs/feature/login/README.md#token
supersededBy: memory/token-format-v2.md
```

- `type`：decision 记录不需要 Design 比较的选择；insight 记录有证据支撑的经验；note 是尚未归类的记录。
- `status`：captured 表示已保存、尚未确认；current 表示现行；superseded 表示不再适用，由 `supersededBy` 指向替代者，或用 `supersession` 写明原因与来源。替代只在同 type 之间，且不得成环。
- `relations`：`supports` 指向它支持的 Feature、Use Case 或 Engineering 的路径或锚点；`amends` 指向宪法条款与款。Issue 指向 Memory 的关系写在 Issue 中，反向关系从中派生。

## 编辑与检索

直接创建、阅读和编辑 Memory 文件，包括状态与关系。`memory activate`、`memory supersede` 与 `memory link` 是写入同样内容的助手：

```sh
concord memory activate token-format
concord memory supersede token-format --replacement token-format-v2
concord list memory --json
concord show token-format-v2 --json
```

`memory link` 写入 `relations`。参数以各命令的 `--help` 为准。`list` 与 `show` 从当前文件派生索引与反向关系，不手工维护 INDEX。

`concord check` 校验字段与关系目标；`concord check --since <base>` 另外检查状态转换是否合法，例如 note 不能成为 current，宪法修订是否附带 `amends` 的 Decision。
