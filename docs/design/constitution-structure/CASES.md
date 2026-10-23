# 宪法的结构、关联与写法

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 在 C-011 第一款前插入一款，修订后重新检查 | 指向 `#c-011-test-source` 的链接仍然有效，没有 finding |
| C2 | Feature 正文写 `[C-099](../../constitution.md#c-099)` | `check` 退出 1，finding 为 `AnchorNotFound`，指向该文件与行 |
| C3 | 一个 Use Case 与一个 Design 页面各链接 `#c-007-credentials` | `constitution show --json` 的 `references` 列出两处，含路径、行号、条款与款 |
| C4 | Feature 正文不链接任何条款 | 不产生 finding；依据关系不是必填登记 |
| C5 | 宪法仍使用 `<a id>` 行 | 普通命令返回 `ConstitutionMigrationRequired`；`constitution migrate` 转换后通过 |
| C6 | Feature 元数据仍有 `constitutionRefs` | 返回 `ConstitutionMigrationRequired`；迁移把每条引用写成正文链接并删除该字段 |
| C7 | `constitution amend` 删除一款，而该款仍被链接 | 拒绝修订，返回 `ConstitutionClauseReferenced` 并列出引用位置 |
| C8 | 拟修订正文中一款写入存储引擎名与桥接细节 | 写作规则指明该内容属于 architecture 页；审阅可引用总则的条款写法 |
| C9 | 对本仓库执行迁移并改写宪法 | `check` 通过；迁移前后依据关系集合一致；Problem 以 red 与 green 收据关闭 |
| C10 | 代码块或行内代码中出现 `{#c-020}` 或宪法链接 | 不产生 ID，不建立依据关系，不校验 |
| C11 | 正文写“C-011 第 3 款”而不是链接 | 不建立依据关系；写作规则要求改为链接 |
