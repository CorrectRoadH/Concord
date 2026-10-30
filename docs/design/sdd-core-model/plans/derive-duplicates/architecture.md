# derive-duplicates 架构

## 布局与身份

| 路径 | 类别 |
| --- | --- |
| `docs/feature/<f>/README.md` | Feature |
| `docs/feature/<f>/use-case/<u>.md` | Use Case，属于 `<f>` |
| `docs/feature/<f>/architecture.md` | 实现：实体归属、数据流、不变量、失败与资源生命周期 |
| `docs/feature/<f>/cli.md`、`library.md` | 示例：完整调用、`--json` 输出、退出码与错误；库为签名与返回值 |
| `docs/feature/<f>/` 下其它页面 | 支持页面 |
| `docs/engineering/<t>/` | Engineering，页面结构同 Feature |
| `docs/roadmap/<r>/` | 提案，页面结构同 Feature |
| `docs/design/<d>/`、`docs/research/<r>/` | Design 与 Research |
| `docs/issues/<i>.md`、`memory/<m>.md` | Issue 与 Memory |
| `docs/constitution.md`、`docs/**/concepts.md`、`docs/**/concord-writing.json` | 项目规则 |

身份是 canonical 仓库相对路径。短选择器（Feature 目录名、Use Case 文件名、Issue 与 Memory 文件名）在同类别中歧义时具名拒绝，例如两个 Feature 都有 `use-case/create.md` 时，`show create` 要求写出路径。名称保留 Unicode 原拼写与组合标记，大小写与 Unicode 规范化碰撞沿用现行路径保护。名称取自正文唯一的一级标题，按 Markdown 语法树识别，代码块中的标题不计。

frontmatter 中的路径值一律是仓库相对路径。

## 字段

Spec、提案、Research 与 Design 没有 frontmatter。Research 的观察日期与来源写在正文的「来源」小节，格式由写作模板固定。Design 的候选来自 `plans/` 子目录，裁决由 `design decide` 校验全部候选与 Limits 后写入 DECISION 的 `Selected:` 行；直接编辑该行时 `check` 用同一规则校验。

宪法：

```yaml
status: active   # draft 或 active
```

Issue（字段只在非空时出现）：

```yaml
status: open
relations:                       # 参与生命周期裁决的关系
  - role: root-cause             # investigation、root-cause、decision、delivery
    target: memory/token-race.md
source:                          # 远端来源的稳定身份
  provider: github
  instance: api.github.com
  id: "1234567"
  firstSeenAt: 2026-10-30T00:00:00Z
closure:
  kind: fixed                    # fixed、delivered、duplicate、declined、invalid、external-fixed
  reason: 修正锁顺序
  verification:                  # 仅 fixed
    defect: 3f2a…                # 测试失败的提交
    fix: 9c1d…                   # 测试通过的提交
    tests: [test/token.test.ts#token race]
```

其它关闭结论沿用现行的必需字段：delivered 的 `target`、duplicate 的 `canonical`、declined 的 `memory`、invalid 的 `evidence`、external-fixed 的 `dependency` 与 `version`。

Memory：

```yaml
type: insight          # decision、insight、note
status: current        # captured、current、superseded；note 只能是 captured
supersededBy: memory/new.md     # superseded 时，或用 supersession 写明原因与来源
```

## 修复核验

`concord issue close <i> --fixed --defect <提交> --fix <提交>` 在关闭前执行：

1. 两个提交都在当前仓库中；工作树干净；`--fix` 默认为 HEAD，`--defect` 默认为最早包含指向该 Issue 的回归测试（标记 `@issue docs/issues/<i>.md`）的提交。
2. 在两个隔离的 detached worktree 中构建并运行这些回归测试。测试文件与其指向的 Spec 在两个提交中字节相同。
3. 缺陷提交上测试以断言失败结束，修复提交上通过。缺测试、无法构建、runner 失败与超时都是 `FixUnverifiable`，不是失败。
4. 核验通过后，以 publication 写入 `closure` 与 `verification`。

`check` 报告 fixed 但没有 `verification`、提交不存在或测试不再指向该 Issue 的 Issue。`concord test verify <i>` 按 `verification` 重放同一核验，供 CI 与任何拿到仓库的人复核；结果只输出，不写入。重放的前提是两个提交可构建，依赖与运行环境可获得；不满足时报告无法重放，不改变已记录的结论。

reopen 删除 `closure`，状态回到 open；之前的核验留在 Git 历史中。

## 配置

`concord.config.ts` 可以不存在。

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `runner` | 无 | 需要 `test run` 或修复核验时 |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需 |

删除的配置项：

- `format`；
- `projectId`：工作区身份取 root 与 Git-private 目录，配置快照仍绑定原文摘要；
- `constitution`：文件存在即启用，status 决定是否采用；
- `documentDefaults` 与 `projectTypes`：创建时选页面；
- `memorySources`：固定为 `memory/`。

发现范围、runner 输入与 Web 的源码写入范围分别定义；默认值不扩大 Web 的写入范围。

## 改写

一次性脚本，不进入产品：

- 删除 Spec、提案、Research 与 Design 的 frontmatter；Research 的观察日期与来源移入正文。
- 宪法 frontmatter 只留 `status`。
- Issue 按上表改写；`memoryRelations` 改为 `relations`；`adoptions.current` 改为 `relations` 中的 delivery 角色指向 Spec；空字段删除。
- 每个 Memory Problem 改写为 Issue：已记录的 fixed 结论写为 closure，没有提交级核验的标记为 `reason` 中的作者声明并由 `check` 报告缺少 verification，等待重新核验；Memory 的其它类型改为 `type` 与 `status`。
- `lifecycle.md` 并入所在 Feature 的 `architecture.md`。
- Git-private 收据原地保留，不读取、不删除。

## 验证

- Cases C1–C9 在打包 CLI 的隔离消费者中执行。
- 修复核验：同一提交加入测试与修复时，默认 defect 为该提交，核验报 `FixUnverifiable` 并提示用 `--defect` 指向修复前的提交；多提交修复、merge、squash 后的提交、shallow clone 分别有确定结果。
- 本仓库改写后 `check` 无 finding；`trace` 的关系数按新归属与改写前一致。
