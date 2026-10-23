---
format: concord.document/v1
id: recall-and-maintain-memory
title: 通过工具检索与维护工程知识
createdAt: 2026-09-23T02:08:50.650Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 通过工具检索与维护工程知识

## 用户目标

Agent 和维护者在开始工作前，要找到以前的排障经过、根因、决策和经验，并在工作中更新它们。工程知识只通过 Concord 命令读写。手工维护的索引会和真实记录脱节，直接改文件会绕过摘要保护和生命周期检查。

Memory 保存排障经过、调查结论与可复用经验，Issue 保存待调查的观察，契约声明目标、行为与约束。三者不复制同一事实。

## 起始状态

- 项目已经初始化，`concord.config.ts` 的 `memorySources` 至少有一个可写来源，默认是 `memory/`。

## 完整路径

1. 列出全部 Memory。 {#index}

   ```sh
   concord --json memory index
   ```

   ```json
   {"operation":"memory-index","documents":[{"path":"memory/duplicate-sku.md","id":"duplicate-sku","title":"重复加入覆盖数量","digest":"sha256:28951a...","memoryKind":"problem","state":"open"}]}
   ```

2. 按关键词检索。 {#recall}

   ```sh
   concord memory recall "sku 覆盖"
   ```

   ```text
   memory recall
   memory/duplicate-sku.md — 重复加入覆盖数量
     problem: open
     同一 SKU 第二次加入时数量被覆盖。根因：addItem 直接赋值。
   ```

   查询按空白拆成词项。每个词项不区分大小写地匹配标题或正文，全部词项都命中的记录才返回，词项顺序不影响结果。人读输出列出标题、状态和含首个命中词项的正文片段。`--json` 返回完整正文与 `digest`。`issue recall` 使用同一规则。

3. 新建记录。 {#add}

   ```sh
   concord memory add duplicate-sku --kind problem --title "重复加入覆盖数量" --body ./problem.md
   ```

   `--kind` 取 `problem`、`decision`、`insight` 或 `note`。`--body -` 从 stdin 读取正文。

4. 用最新摘要修改正文。 {#edit}

   ```sh
   concord --json memory edit duplicate-sku --body ./problem.md --expected-digest sha256:28951a...
   ```

   ```json
   {"operation":"set-author","dryRun":false,"changedPaths":["memory/duplicate-sku.md"]}
   ```

   摘要来自 `memory index`、`memory recall --json` 或 `memory show --json`。

5. 状态、关联与证据用对应的具名命令修改：`memory activate`、`memory resolve`、`memory reopen`、`memory promote` 等。 {#lifecycle}

## 结果

`index` 与 `recall` 只读，不写文件。`recall` 返回记录原文与摘要，不生成证据。`edit` 只改正文，不改 `evidenceRequirement`、`epoch`、证据或关联。

| 错误 | 触发条件 |
| --- | --- |
| `InvalidInput` | 查询为空：`recall/search query must be non-empty` |
| `PreimageChanged` | `--expected-digest` 不是当前摘要：`memory/duplicate-sku.md changed; use its current digest` |
| 具名拒绝 | 两个来源有同名短 ID，需要改用完整路径 |
| 具名拒绝 | 目标来源是只读的 |

`list`、`index`、`recall` 与 `search` 读取相应来源的全部记录。范围内有坏记录、来源缺失、配置错误或未完成的写入时，查询失败，不返回部分结果。

## 规则

- 不维护 `INDEX.md` 一类的人工索引，不用 `cat` 或 `rg` 代替 `recall`。
- 不直接编辑 Memory 或 Issue 文件、metadata、history 或反向关系。`--body` 读取的文件或 stdin 只是命令输入。
- `recall` 是本地确定性的文本匹配，不调用模型或远端服务，不做向量或语义检索。
- 按完整路径编辑时，只检查目标记录与其摘要。按短 ID 编辑时，先读取该类别的全部候选，唯一匹配才写入。集合不完整或 ID 有歧义时拒绝，这样不会漏看一个解码失败的同名记录。
- 创建时检查目标路径与来源写权限。Issue 还检查同类 ID 集合，Problem 还检查证据政策。

`init` 生成的 `AGENTS.md` 区块、`docs/concord.md` 与随包 skill 都把 Agent 引到这些命令。

## 契约来源

- 读取范围与失败边界：[架构](../architecture.md)
- Memory 状态与证据：[文档模型](../../../document-model.md)
