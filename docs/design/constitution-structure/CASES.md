# 宪法的结构、关联与写法

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 在 C-011 第一款前插入一款，修订后重新检查 | 指向 `#c-011-1` 的链接仍然有效，新款取未使用的 ID，没有 finding |
| C2 | Feature 正文写 `[C-099](../../constitution.md#c-099)` | `check` 退出 1，finding 为 `AnchorNotFound`，指向该文件与行 |
| C3 | 一个 Use Case 与一个 Design 页面各链接 `#c-007-4` | `constitution show --json` 的 `references` 列出两处，含路径、行号、条款与款 |
| C4 | Feature 正文不链接任何条款 | 不产生 finding；依据关系不是必填登记 |
| C5 | 宪法仍使用 `<a id>` 行 | 普通命令返回 `ConstitutionMigrationRequired`；`constitution migrate` 转换后通过 |
| C6 | Feature 元数据仍有 `constitutionRefs` | 返回 `ConstitutionMigrationRequired`；迁移把每条引用写成正文链接并删除该字段 |
| C7 | `constitution amend` 删除一款，而该款仍被链接 | 拒绝修订，返回 `ConstitutionClauseReferenced` 并列出引用位置 |
| C8 | 拟修订正文中一款写入存储引擎名与桥接细节 | 写作规则指明该内容属于 architecture 页；审阅可引用总则的条款写法 |
| C9 | 对本仓库执行迁移并改写宪法 | `check` 通过；每条旧元数据关系都投射为同一 owner 的正文链接；Problem 以同一签发工具的 red 与 green 收据关闭 |
| C10 | 代码块或行内代码中出现 `{#c-020}` 或宪法链接 | 不产生 ID，不建立依据关系，不校验 |
| C11 | 正文写“C-011 第 3 款”而不是链接 | 不建立依据关系；写作规则要求改为链接 |
| C12 | 附页 `architecture.md` 中一句话链接 `#c-003-1` | 关系定位到该附页与行；metadata-owned 无法表达 |
| C13 | 同一页面以 `../constitution.md#c-001`、`../constitution.md?x#c-001`、`https://example.com/constitution.md#c-001`、图片与引用式链接指向宪法 | 只有第一种是引用；带 query 的返回 `ConstitutionLinkInvalid`；其余不计入 |
| C14 | 迁移在第一个文件替换后中断 | 保留 journal 与已替换文件；`concord recover` 按前后像完成或回退，不加载 owner 图；普通命令返回 `RecoveryRequired` |
| C15 | 已迁移的仓库再次运行 `constitution migrate` | 返回 `{"changedPaths":[]}`，不写文件 |
| C16 | owner 的元数据有 `constitutionRefs: []` | 返回 `ConstitutionMigrationRequired`；迁移删除该字段，不添加链接 |
| C17 | owner 已有一个 `## Constitution` 节，另一个 owner 有两个 | 前者在节末追加链接；后者迁移整体拒绝，返回 `ConstitutionMigrationConflict` |
| C18 | `constitution amend` 同时删除一款与宪法内指向它的链接 | 按候选正文校验，接受修订 |
| C19 | Issue 正文链接一款，作者要删除该款 | amend 拒绝并列出 Issue 位置；作者用 `issue edit` 改链接后再删除 |
| C20 | 宪法列表项带 `{#c-011-1}` | 不成为 Use Case 步骤，不产生 `InvalidStepPosition`，不进入 `trace gaps` |
