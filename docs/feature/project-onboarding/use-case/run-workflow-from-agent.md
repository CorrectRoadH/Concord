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

   每个 skill 只让 agent 运行对应的 `concord --skill <主题>`；项目的 `AGENTS.md` 指定了其它运行方式（例如 `bun run concord`）时按它运行。说明正文来自已安装的 Concord，升级后自动是新版本的说明。

| skill | 读取的 skill 主题 | agent 做什么 |
| --- | --- | --- |
| `concord-spec` | `concord --skill spec` | 读现有 Spec 与品味，写明行为、边界与验收方式；有待决的取舍时写 Design 并请维护者决定 |
| `concord-implement` | `concord --skill implement` | 照着 Spec 实现并关联测试，执行验收；Spec 缺失或与事实冲突时暂停依赖部分，带着证据回到 Spec |
| `concord-review` | `concord --skill review` | 只读对照 diff、关系与实际行为，区分 Spec 冲突、验证失效和产品缺陷，说明证明范围 |
| `concord-fix` | `concord --skill fix` | 确认被违反的 Spec，按[回归核验](../../local-sdlc/use-case/validate-change-with-project-tools.md)选择暂存区或提交核验；已有 Issue 时核验后关闭 |

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

## 验收职责

完成写改任务前必须实际运行 `concord check` 并确认通过。发现问题时继续修复、重跑，不能以记录 Issue、报告 finding 或承诺以后处理替代完成。本次删除或修改 Spec 引起的源码、测试标记与关联迁移属于同一任务，须按已有授权同步完成。若受权限、环境或明确的只读／分工范围阻塞，交付必须标为未完成，列出具体失败、受阻项和所需条件；不得越权修改或把失败写成通过。只读审阅仍只交付发现。指南沿用当前任务的范围与授权。完整开发任务中需要修订 Spec 时，先返回写 Spec 阶段，再继续实现；分工任务交给相应负责人，只有未获授权的关键取舍才需要用户决定。

写 Spec 时，关键保证写明前置条件、触发动作、观察入口、预期结果与失败判据；涉及持久化、消息或资源释放时，验收同时观察副作用。简单行为沿用步骤与结果表，不另填重复清单（[写到实现者不用再问](../../../taste.md#t-11)）。

并发、重试、取消、恢复与资源所有权按实际风险描述合法迁移、禁止状态、终止条件与失败后保留的状态。可观察保证归行为页，内部不变量和原子动作归 architecture；图解只解释已声明的规则，遵守[页面职责](../../../document-model.md#页面职责)。

验收方法选能观察结果的最低测试层。普通行为使用测试，输入组合可以用性质测试；高后果且测试难触达的事件交错可以用模型检查。需要超出有限边界的保证时再考虑证明工具，不要求所有功能采用同一种工具。

采用形式验证时，Spec 声明所验性质、环境假设、探索边界与未覆盖项；涉及最终完成的保证时说明调度与公平性前提。高风险保证还声明验证应能检出的故障，例如漏掉校验或提前释放锁。模型通过只说明该模型在声明条件下满足性质（[只声称证明过的](../../../taste.md#t-5)）。

实现时按 Spec 运行真实入口，在能观察保证的最低层核对动作、结果与副作用。验收环境确认可用条件，隔离数据、端口和实例；正常或失败退出均回收本次创建的资源，取证材料保留在交付位置。外部系统可以在其实际边界模拟，不用内部赋值或测试专用入口代替所验路径。

采用模型时，实现者维护模型动作与代码的对应关系。原子步骤、分支、取值范围或共享状态写入路径变化后重新核对模型；分别验证模型能检出所声明的故障、模型描述当前代码、真实实现满足验收。故障注入在隔离副本执行，不改共享工作区；独立模型不会自动感知产品代码的变化。

审阅保持只读，检查上述证据并在隔离环境复现关键行为。反例用领域语言说明初始条件、事件序列、违反的规则与后果，并对照代码或实际复现；无法发生的步骤先检查模型。验证工具失效、模型偏离代码、产品违反 Spec 与环境阻塞分别报告；不能为通过而削弱性质、缩小边界或按错误实现改写 Spec。

行为保证的变化先经 Spec 明确；模型与验证程序按新 Spec 调整。每项结论说明实际运行范围、假设与遗漏，未运行、被跳过或因预算中止的检查不写成通过。启动、取证、清理与复跑方法归项目的 Engineering 页；测试、模型和关联由各自来源拥有，不在 skill 中维护第二份功能清单或同步历史（[一件事只写一次](../../../taste.md#t-3)）。

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
