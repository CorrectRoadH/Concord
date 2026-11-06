# 项目接入术语表

本页定义项目接入中的概念。[全局术语表](../../concepts.md)中的[快照](../../concepts.md#snapshot)、[skill 主题](../../concepts.md#skill-topic)与[写作指南](../../concepts.md#writing-guide)自动适用于本目录。

## 接入项目 {#adopting-project}

采用 Concord 工作范式的软件仓库。它拥有自己的构建、runner、运行环境与技术栈，Concord 只规定 Spec 布局与关联规则。

旧写法：`消费仓库`

## 托管标记 {#managed-marker}

Concord 标出自己维护内容的 HTML 注释：`SKILL.md` 中记下生成版本的 `concord-managed` 行，以及 `AGENTS.md` 中托管区块首尾的边界行。Concord 只重写或删除带托管标记的文件与区块。

## 托管区块 {#managed-block}

Concord 在根 `AGENTS.md` 中维护的 Concord 指引，首尾各有一条托管标记。init 只追加或刷新它，区块外的字节保留。

## 工作流 skill {#workflow-skill}

`concord init` 或 `concord skills install` 写进 `.agents/skills/` 与 `.claude/skills/` 的四个 skill：`concord-spec`、`concord-implement`、`concord-review` 与 `concord-fix`。每个 skill 让 agent 读取对应的 [skill 主题](../../concepts.md#skill-topic)。

Claude Code 中用 `/concord-spec` 这样的斜杠命令触发，Codex 中用 `$concord-spec` 触发，agent 也会按任务自动选用。

## 配置快照 {#config-snapshot}

一次读取得到的 `concord.config.ts` 原文、摘要与解码后的配置，代码中是 `ConfigSnapshot`；文件不存在时记为 absent。写入事务冻结它，普通写入要求当前配置仍等于冻结的原文。
