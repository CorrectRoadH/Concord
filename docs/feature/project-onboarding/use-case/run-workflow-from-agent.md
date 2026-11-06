# 用工作流 skill 走开发流程

## 用户目标

维护者在 Claude Code 或 Codex 里和 agent 一起开发，想用一条短命令让 agent 进入开发流程的某一步：写 Spec、照着 Spec 实现、按 Spec 验收或修复缺陷，而不必每次重新解释流程。

## 起始状态

- 仓库已经用 Concord 初始化。
- agent 能运行已安装的 `concord`。

## 完整路径

1. 安装工作流 skill。 {#install}

   `concord init` 已经安装它们。之前初始化的仓库运行：

   ```sh
   concord skills install
   ```

   以下为预期输出：

   ```text
   Created:
     .agents/skills/concord-spec/SKILL.md
     .agents/skills/concord-implement/SKILL.md
     .agents/skills/concord-review/SKILL.md
     .agents/skills/concord-fix/SKILL.md
     .claude/skills/concord-spec/SKILL.md
     .claude/skills/concord-implement/SKILL.md
     .claude/skills/concord-review/SKILL.md
     .claude/skills/concord-fix/SKILL.md

   Next: commit these files so everyone on the project gets the commands.
   ```

   Codex 从 `.agents/skills/` 读取 skill，Claude Code 从 `.claude/skills/` 读取。两处是内容相同的普通文件，都由 Concord 生成并一起更新，和其它文档一样在同一次写入中提交，中断后由 `concord recover` 恢复。

2. 在 agent 里触发一步。 {#invoke}

   Claude Code 中输入：

   ```text
   /concord-spec 购物车支持优惠券
   ```

   Codex 中输入 `$concord-spec 购物车支持优惠券`。命令后的文字是本次任务。agent 也会在任务符合 skill 描述时自动选用它。

3. agent 读取当前版本的说明并执行。 {#follow}

   每个 skill 只让 agent 运行对应的 `concord --skill <主题>`；项目的 `AGENTS.md` 指定了其它运行方式（例如 `pnpm concord`）时按它运行。说明正文来自已安装的 Concord，升级后自动是新版本的说明。

| skill | 读取的 skill 主题 | agent 做什么 |
| --- | --- | --- |
| `concord-spec` | `concord --skill spec` | 读现有 Spec 与品味，把需求写成 Feature、Use Case 与必要的 architecture 页；有待决的取舍时写 Design 并请维护者决定 |
| `concord-implement` | `concord --skill implement` | 照着指定的 Spec 实现，给代码加代码声明、给测试加标记，运行检查；Spec 缺失或与事实冲突时停下，带着证据回到 Spec |
| `concord-review` | `concord --skill review` | 对照 Spec 检查一组改动的 diff、关系缺口与实际运行，逐条给出不符合 Spec 的位置 |
| `concord-fix` | `concord --skill fix` | 确认缺陷违反了哪条 Spec，提交失败的回归测试，再提交修复，用 `issue close --fixed` 核验 |

4. Concord 升级后更新 skill 文件。 {#update}

   新版本可能增删 skill 或改写 skill 的描述，这时项目里的 `SKILL.md` 需要重写。`concord check` 与 `concord doctor` 发现后给出提示，不使检查失败：

   ```text
   advisories:
     WorkflowSkillsOutdated: .claude/skills/concord-fix/SKILL.md, .agents/skills/concord-fix/SKILL.md
   Next: concord skills install
   ```

   运行 `concord skills install` 重写，然后提交。以下为预期输出：

   ```text
   Updated:
     .agents/skills/concord-fix/SKILL.md
     .claude/skills/concord-fix/SKILL.md
   Unchanged:
     …
   ```

   比较内容时忽略托管标记中的版本：版本较旧但正文与当前版本将写入的相同，不提示；两处副本也按忽略版本后的内容比较。`skills install` 仍把这类文件改写为当前版本的托管标记，列在 `Updated` 下。检查只读，不替你写文件。托管标记记下生成它的 Concord 版本，例如 `<!-- concord-managed version=0.9.0 -->`；同一项目里有人用的 Concord 版本较旧时，他不会因为别人已经更新过文件而看到提示。

## 结果

项目里的人和 agent 用同一组命令走同一个流程，流程说明随安装的 Concord 版本更新。

| 情形 | 结果 |
| --- | --- |
| skill 文件已由 Concord 生成 | 重写为当前内容，列在 `Updated` 或 `Unchanged` 下 |
| 任一目标路径已有不带托管标记的文件，或是目录、符号链接 | 返回 `SkillPathOccupied`，不写任何文件 |
| 加 `--dry-run` | 列出将要创建或更新的路径，不写文件 |
| 维护者不想要某个 skill | 直接删除两处对应目录，检查不会为缺少它提示；`concord skills install` 会重新创建 |
| 带托管标记的文件由更旧的版本生成，内容与当前版本将写入的不同 | `check` 与 `doctor` 给出 `WorkflowSkillsOutdated`；`skills install` 重写，列在 `Updated` 下 |
| 托管标记没有版本 | 按更旧的版本处理 |
| 带托管标记的文件由更新的版本生成 | 不提示；显式运行 `skills install` 时照常按当前版本重写 |
| `.agents/` 与 `.claude/` 中同名 skill 内容不同 | 给出 `WorkflowSkillsOutdated` |
| 当前版本已不提供某个带托管标记的 skill | 给出 `WorkflowSkillsOutdated`；`skills install` 删除它，列在 `Removed` 下 |
| 项目里一个工作流 skill 都没有 | 不提示；`doctor` 的 `nextSteps` 建议运行 `concord skills install` |

Concord 生成的 `SKILL.md` 带有 `concord-managed` 托管标记，只有带托管标记的文件会被重写或删除。每个 skill 目录只有这一个 `SKILL.md`，不放说明副本，避免它们随版本过期。

## Spec 来源

[目标与范围](../README.md)；命令与输出见 [CLI](../../local-sdlc/cli.md#接入)；流程规则见[品味](../../../taste.md#t-11)。
