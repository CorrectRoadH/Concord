# 移动 Spec 文档并改写关系

## 用户目标

维护者整理 Spec 时，要把一个 Use Case 移到另一个 Feature、给一个文档包改名，或把一页移到别的文档包。指向它的链接、Issue 与 Memory 关系、测试标记和代码声明分散在整个仓库；手工逐处改写既慢又容易漏。维护者用一条命令完成移动，所有受 Concord 管理的引用都改指新路径，剩下无法安全改写的文本引用也逐处列出。

## 起始状态

- 项目已经初始化。
- 目标文档包已经存在：移动单页时，用 `concord new feature <id>` 先建好目标 Feature。

## 完整路径

本页示例为预期输出。

1. 预览移动。 {#preview}

   ```sh
   concord --dry-run move docs/feature/experiments/use-case/cache-explicit-rerun.md docs/feature/experiment-cache/use-case/explicit-rerun.md
   ```

   ```text
   Would apply move:
     docs/feature/experiments/use-case/cache-explicit-rerun.md → docs/feature/experiment-cache/use-case/explicit-rerun.md

   Changed:
     docs/feature/experiment-cache/use-case/explicit-rerun.md
     docs/feature/experiments/use-case/README.md
     docs/feature/experiments/use-case/cache-explicit-rerun.md
     e2e/cli/test/cache-hit.test.ts
     src/runner/reuse-plan.ts

   Not rewritten:
     e2e/cli/test/cache-hit.test.ts.cases.evidence.json:127
   ```

   `Changed` 列出将被写入的全部文件：被移动的文件既出现在原路径（删除）也出现在新路径（创建），其余是改写了引用的文件。`Not rewritten` 列出仓库中仍以文本形式出现原路径、但不属于 Concord 管理引用的位置，见[移动文档](../cli.md#移动文档)。

2. 执行移动。 {#apply}

   ```sh
   concord --json move docs/feature/experiments/use-case/cache-explicit-rerun.md docs/feature/experiment-cache/use-case/explicit-rerun.md
   ```

   ```json
   {"operation":"move","dryRun":false,"moves":[{"from":"docs/feature/experiments/use-case/cache-explicit-rerun.md","to":"docs/feature/experiment-cache/use-case/explicit-rerun.md"}],"changedPaths":["docs/feature/experiment-cache/use-case/explicit-rerun.md","docs/feature/experiments/use-case/README.md","docs/feature/experiments/use-case/cache-explicit-rerun.md","e2e/cli/test/cache-hit.test.ts","src/runner/reuse-plan.ts"],"unmanagedReferences":[{"path":"e2e/cli/test/cache-hit.test.ts.cases.evidence.json","line":127}]}
   ```

3. 给整个文档包改名。 {#rename-package}

   ```sh
   concord move docs/feature/sandbox-nested-docker docs/feature/nested-docker
   ```

   目录内的全部文件一起移动，包括 `assets/` 下的图片等非 Markdown 附件；目录内的相对链接继续指向移动后的文件。

4. 逐处处理 `Not rewritten`，再运行检查。 {#check}

   ```sh
   concord check
   ```

   `Not rewritten` 中的位置由维护者判断：历史证据、生成文件或外部系统的记录通常保留原样；说明文档里的路径手工改写。

## 结果

被移动的文件出现在新路径，原路径不再存在。下列引用全部改指新路径，`#anchor` 原样保留：

- `docs/` 与 `memory/` 下 Markdown 中解析到被移动文件的相对链接、图片与链接定义；
- 被移动 Markdown 自身的相对链接，继续指向原来的目标；
- Issue 与 Memory 的正向关系；
- 测试根中的 `@feature`、`@use-case` 标记目标；
- 源码根中的 `@concord-implements` 代码声明目标。

被移动 Use Case 的步骤 ID 不变，所以指向步骤的测试与代码关系在移动后仍然成立，归属改为目标目录所在的文档包。移动全部写入或全部不写；中断后由 `concord recover` 完成或回退。

源或目标不合法、目标已存在、布局不合法或规划期间文件被修改时，命令拒绝执行且不写任何文件；错误码见[移动文档](../cli.md#移动文档)。

Roadmap 采用为 Feature 仍使用[`roadmap start`](plan-and-adopt-contracts.md#adopt)；`move` 不改变文档的类别。

## Spec 来源

- 命令、输出与错误：[移动文档](../cli.md#移动文档)
- 原子写入与恢复：[步骤改写的发布](../architecture.md#步骤改写的发布)
