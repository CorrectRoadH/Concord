# 渐进选择并初始化项目

## 用户目标

维护者从尚未接入的 Git worktree 顶层完成初始化，得到可以继续维护的 Concord 项目；不需要 runner 或覆盖默认值的项目不写配置。

## 起始状态

- 当前目录是 Git worktree 顶层，已有 `src/` 与 `test/`，还没有 `docs/taste.md`。

## 完整路径

1. 预览要写入的文件。 {#preview}

   ```sh
   concord --dry-run init
   ```

   输出（节选）：

   ```text
   Would apply init:
     docs/taste.md
     docs/concord.md
     docs/_template/feature-design/README.md
     ...
   ```

   预览列出完整的文件变更，不写项目文件。init 按约定发现测试根与源码根，本例是 `test/` 与 `src/`。

2. 初始化。 {#init}

   ```sh
   concord init
   ```

   输出（节选）：

   ```text
   Applied init:
     docs/taste.md
     docs/concord.md
     ...
     docs/architecture.md
     docs/writing.md
     ...
     AGENTS.md
     .agents/skills/concord-spec/SKILL.md
     ...

   Start here: docs/concord.md
   Writing guide: concord --skill start
   Inspect configuration: concord doctor
   ```

   在终端中 init 逐项询问测试根、源码根与 runner；非 TTY 不等待交互，按确定的默认值执行。`--test-root`、`--source-root`、`--runner-config`、`--docs-only` 与 `--yes` 表达同样的选择。本例没有选择 runner 或覆盖，所以不创建 `concord.config.ts`。

   init 写入的文件：

   - `docs/taste.md`：项目品味，只有写法说明与示例。
   - `docs/architecture.md`：系统设计入口；各 Feature 的内部设计放在所属的 architecture 页。
   - `docs/writing.md`：缺失时采用随包预设，见[写作管理](../../documentation-quality/use-case/manage-writing.md)。
   - `AGENTS.md` 中的 Concord 托管区块：引导 coding agent 运行 `concord --skill` 读取当前安装版本的说明。
   - 四个工作流 skill，见[用工作流 skill 走开发流程](run-workflow-from-agent.md)。

3. 需要 `test run` 或修复核验时，初始化时就配置 runner。 {#runner}

   ```sh
   concord init --test-root spec --runner-config runner.json
   ```

   `runner.json` 是一个 runner 对象，例如 `{"argv":["node","--test","{file}"],"timeoutMs":60000}`。init 据此创建 `concord.config.ts`：

   ```ts
   export default {
     "testRoots": [
       "spec"
     ],
     "runner": {
       "argv": [
         "node",
         "--test",
         "{file}"
       ],
       "timeoutMs": 60000
     }
   };
   ```

   测试或实现不在约定位置时用 `--test-root`、`--source-root` 覆盖发现范围；没有测试的项目可以没有测试根。之后的修改见[安全维护项目配置](maintain-project-config.md)。

4. 让 agent 读取 Concord 指引与写作指南。 {#guide}

   根 `AGENTS.md` 的托管区块要求 agent 运行 `concord --skill`，按任务读取当前安装版本的说明。init 最后给出的 `concord --skill start` 怎样开始写 Spec，见[初始化后开始写 Spec](start-writing-specs.md)。

5. 查看实际生效的配置与待完善项。 {#doctor}

   ```sh
   concord doctor
   ```

   输出（节选）：

   ```text
   configuration:
     testRoots: 
       test
     sourceRoots: 
       src
   missingTestRoots: none
   missingSourceRoots: none
   findings: none
   nextSteps: 
     Fill in a Feature and Use Case.
     Use concord test marker to connect an existing test.
   ```

6. 写下第一条品味。 {#taste}

   直接编辑 `docs/taste.md`，用维护者确认的条目替换模板示例，写法见[写下项目的品味](../../taste/README.md)。模板示例不是项目规则。

## 结果

| 情形 | 结果 |
| --- | --- |
| 新项目 | 必有 `docs/taste.md`；其中的示例由作者写入真实条目时替换 |
| 没有选择 runner 或覆盖 | 不创建 `concord.config.ts`；`check`、`trace` 与 Web 工作台按[默认值](../format.md#配置项)工作 |
| 没有 `AGENTS.md` | 创建它 |
| 已有 `AGENTS.md` | 只追加或刷新边界明确的托管区块，区块外的原字节保留 |
| `AGENTS.md` 中的托管标记残缺 | 原子拒绝，不覆盖未知内容 |
| `docs/architecture.md` 已存在 | 保留原文 |
| 已有全局写作规则 | 保留原文；新项目生成的指南和模板通过随包预设 |
| 交互中取消、选项非法或文件冲突 | 不留下部分初始化，例如再次 init 时返回 `InitializationConflict`，不覆盖已有文件 |
| 已有 `concord.config.ts` 时再次 init | 不覆盖既有项目配置，例如返回 `ProjectExists` |
| 非 TTY | 不等待交互，结果确定 |
| 配置无效 | 返回具名错误，保留原文件，不执行配置模块，见[校验错误](../format.md#校验错误) |
| `--dry-run` | 不写项目文件 |
| 仓库已有 owner 或未完成 journal | 预览遵守未完成 journal 的障碍；确认后在写互斥下重验期望摘要 |
| 没有 owner、没有锁的新仓库 | 不创建私有状态 |
