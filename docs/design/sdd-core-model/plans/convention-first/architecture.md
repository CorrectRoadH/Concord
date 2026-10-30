# convention-first 架构

## 布局与身份

| 路径 | 类别 | ID |
| --- | --- | --- |
| `docs/feature/<f>/README.md` | Feature | `<f>` |
| `docs/feature/<f>/use-case/<u>.md` | Use Case，属于 Feature `<f>` | `<u>`，在所属 Feature 内唯一 |
| `docs/feature/<f>/architecture.md` | Feature 的实现：实体归属、数据流、不变量、失败与资源生命周期 | — |
| `docs/feature/<f>/cli.md`、`library.md` | Feature 的示例：完整调用、`--json` 输出、退出码与错误；库为签名与返回值 | — |
| `docs/feature/<f>/` 下其它页面 | 支持页面，归属所在 Feature | 路径 |
| `docs/engineering/<t>/README.md` 与其下页面 | Engineering | `<t>` |
| `docs/design/<d>/README.md` | Design；`plans/<p>/README.md` 为候选 `<p>` | `<d>` |
| `docs/research/<r>/README.md` | Research | `<r>` |
| `docs/issues/<i>.md` | Issue | `<i>` |
| `memory/<m>.md` | Memory | `<m>` |
| `docs/constitution.md` | 宪法，存在即启用 | — |
| `docs/**/concepts.md`、`docs/**/concord-writing.json` | 概念与写作政策，目录决定作用域 | — |

`docs/` 下其它 Markdown 是普通文档，不是 owner。目录名与文件名即 ID，允许 Unicode 字母、数字与单连字符；同一类别内 ID 唯一。名称取自正文唯一的一级标题，缺少或多于一个时报告 finding。

## 元数据

Spec、Design 与 Research 没有 frontmatter；出现 frontmatter 时报告 finding。

Design 的候选是 `plans/` 下的子目录；DECISION 正文的 `Selected: [<p>](plans/<p>/README.md)` 是唯一裁决，缺少即未裁决；理由与被否决的选项写在 DECISION 正文。暂缓写成 `Deferred:` 行加理由。

Issue：

```yaml
status: open          # open 或 closed
closure:              # 只在 closed 时出现
  kind: fixed         # fixed、delivered、duplicate、declined、invalid、external-fixed
  reason: ...
```

Issue 的调查、根因与决策关系是正文中指向 Memory 的链接；交付关系是指向 Spec 的链接；远端来源是正文的「来源」小节中的 URL。不保存历史数组；关闭理由在 `closure.reason`，过程在 Git。

Memory：

```yaml
type: insight         # decision、insight 或 note
supersededBy: memory/<m>.md   # 只在被替代时出现
```

Memory 指向 Spec 的正文链接即它所支持的规则。宪法的采用与修订各写一条 `type: decision` 的 Memory，正文链接受影响的条款。

## 配置

`concord.config.ts` 可以不存在。存在时只声明项目确实要选择的内容：

| 项 | 默认 |
| --- | --- |
| `runner` | 无；`concord test run` 需要它 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5` | 无 |
| `ignore` | 无；标记发现另外遵守 `.gitignore` |

删除的配置项：

- `format`；
- `projectId`，身份取 worktree 根与 Git-private 目录；
- `testRoots` 与 `sourceRoots`，标记在全部 Git 跟踪文件中发现；
- `constitution`，文件存在即启用；
- `documentDefaults`，创建时用参数选择页面；
- `memorySources`，固定为 `memory/`；
- `projectTypes`；
- `docsWork`，并入 runner 的检查命令或删除，待实现评估。

## 检查

`concord check` 报告：

- 放置：不在约定位置的 owner、frontmatter 出现在不该有的类别、缺少或重复一级标题、ID 冲突。
- 关系：正文链接与标记指向不存在的文件或锚点、Memory 的 `supersededBy` 不是 Memory、Issue 的关闭关系不满足。
- 修复：`closure: fixed` 的 Issue 没有回归测试指向它。
- 写作与概念：沿用现行规则。
- 缺口：`trace gaps` 列出没有测试的 Use Case；它是报告，不使 `check` 失败。

## 修复的证明

不保存收据或证据记录。修复的证明由 Git 与测试复现：

1. 回归测试用标记 `@issue docs/issues/<i>.md` 指向它守护的 Issue，同时照常指向 Use Case。
2. 关闭 Issue 的提交就是修复提交，从 Git 历史取得，不写进文件。
3. `concord test verify <i>` 在修复提交与其父提交上各运行一次该 Issue 的回归测试，要求修复提交通过、父提交失败；结果只输出，不保存。CI 对本次变更中关闭的 Issue 运行它。
4. 门禁在每次提交上运行全部测试，修复之后的回归由门禁发现。

`check` 只要求 fixed 的 Issue 至少有一个回归测试；「修复前确实失败」由 `test verify` 按需复现，任何拿到仓库的人都能重新验证。

## 迁移与影响

一次性改写，由脚本完成，脚本不进入产品：

- 删除全部 Spec、Design 与 Research 的 frontmatter；
- Issue 与 Memory 改为上表字段，关系写进正文；
- 每个 Roadmap 改写为 Feature，`lifecycle.md` 并入所在 Feature 的 `architecture.md`；
- 每个 Memory Problem 改写为 Issue，已有的回归测试标记改为指向该 Issue；
- 删除 `concord.config.ts` 中的默认项与 Git-private 目录中的收据。

现行 Spec 中描述元数据与命令的页面（document-model、local-sdlc 的 library 与 cli、project-onboarding、documentation-quality 的相关段落、各 skill）随裁决改写。

## 验证

- C1–C9 在打包 CLI 的隔离消费者中执行。
- 本仓库改写后 `concord check` 无 finding，`trace` 的关系数与改写前相同（Roadmap 与 Problem 的关系按新归属计算）。
- 零配置消费者（只有 `docs/`）运行 `check`、`trace`、`show` 成功。
