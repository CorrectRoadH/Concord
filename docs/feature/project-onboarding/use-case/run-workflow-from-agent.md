# 用斜杠命令走开发流程

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
     .claude/skills/concord-spec -> ../../.agents/skills/concord-spec
     .claude/skills/concord-implement -> ../../.agents/skills/concord-implement
     .claude/skills/concord-review -> ../../.agents/skills/concord-review
     .claude/skills/concord-fix -> ../../.agents/skills/concord-fix

   Next: commit these files so everyone on the project gets the commands.
   ```

   Codex 从 `.agents/skills/` 读取 skill，Claude Code 从 `.claude/skills/` 读取，两处指向同一份文件。

2. 在 agent 里触发一步。 {#invoke}

   Claude Code 中输入：

   ```text
   /concord-spec 购物车支持优惠券
   ```

   Codex 中输入 `$concord-spec 购物车支持优惠券`。命令后的文字是本次任务。agent 也会在任务符合 skill 描述时自动选用它。

3. agent 读取当前版本的说明并执行。 {#follow}

   每个 skill 只让 agent 运行对应的 `concord --skill <主题>`，说明来自已安装的 Concord，升级后不需要改写项目里的 skill 文件。

| skill | 读取的主题 | agent 做什么 |
| --- | --- | --- |
| `concord-spec` | `concord --skill spec` | 读现有 Spec 与品味，把需求写成 Feature、Use Case 与必要的 architecture 页；有待决的取舍时写 Design 并请维护者决定 |
| `concord-implement` | `concord --skill implement` | 照着指定的 Spec 实现，给代码加代码声明、给测试加标记，运行检查；Spec 缺失或与事实冲突时停下，带着证据回到 Spec |
| `concord-review` | `concord --skill review` | 对照 Spec 检查一组改动的 diff、关系缺口与实际运行，逐条给出不符合 Spec 的位置 |
| `concord-fix` | `concord --skill fix` | 确认缺陷违反了哪条 Spec，提交失败的回归测试，再提交修复，用 `issue close --fixed` 核验 |

## 结果

项目里的人和 agent 用同一组命令走同一个流程，流程说明随安装的 Concord 版本更新。

| 情形 | 结果 |
| --- | --- |
| skill 文件已由 Concord 生成 | 重写为当前内容，列在 `Updated` 或 `Unchanged` 下 |
| 同一路径已有不是 Concord 生成的文件或目录 | 返回 `SkillPathOccupied`，不写任何文件 |
| 加 `--dry-run` | 列出将要创建或更新的路径，不写文件 |
| 维护者不想要某个 skill | 直接删除对应目录与链接；`concord skills install` 会重新创建 |

Concord 生成的 `SKILL.md` 带有 `concord-managed` 标记行，只有带标记的文件会被重写。符号链接只在目标是对应的 `.agents/skills/concord-<名称>` 时视为 Concord 生成。

## Spec 来源

[目标与范围](../README.md)；命令与输出见 [CLI](../../local-sdlc/cli.md#接入)；流程规则见[品味](../../../taste.md#t-11)。
