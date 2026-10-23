---
format: concord.document/v1
id: plan-and-adopt-contracts
title: 规划并采用文档契约
createdAt: 2026-09-13T11:00:34.175Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 规划并采用文档契约

## 用户目标

功能负责人用 Feature、Use Case、Roadmap、Design 与 Engineering 分别写当前能力、用户路径、待采用的方向、方案比较和仓库维护机制。方向准备实现时，把 Roadmap 整体采用为 Feature，不手工复制文件。

## 起始状态

- 项目已经初始化。

## 完整路径

1. 创建 Feature 与 Use Case。 {#create}

   ```sh
   concord feature create cart --title "购物车" --pages cli,use-case
   concord use-case create add-item --feature cart --title "加入商品"
   ```

   Feature、Roadmap 与 Design 候选必须有 README，`--pages` 从 `library`、`cli`、`architecture`、`lifecycle`、`use-case` 中选择附页。Design 外层的 GOALS、LIMITS、CASES、DECISION 总是生成。Engineering 从目标、机制、使用、验收四节开始，按主题加页。

2. 读取并修改附页。 {#edit-page}

   ```sh
   concord --json feature page show cart cli
   concord feature page set cart cli --body ./cli.md --expected-digest sha256:...
   ```

   `page show --json` 返回 `operation`、`path`、`body` 与 `digest`。`page set` 只在文件仍是这个摘要时写入，否则返回 `PreimageChanged`。

3. 把尚未采用的方向写成 Roadmap。 {#roadmap}

   ```sh
   concord --json roadmap create checkout --title "结账" --pages use-case
   ```

   ```json
   {"operation":"create-roadmap","dryRun":false,"changedPaths":["docs/roadmap/checkout/README.md","docs/roadmap/checkout/use-case/README.md"]}
   ```

4. 准备实现时采用 Roadmap。 {#adopt}

   ```sh
   concord --json roadmap adopt checkout --feature checkout
   ```

   ```json
   {"operation":"adopt-roadmap","dryRun":false,"changedPaths":["docs/feature/checkout/README.md","docs/roadmap/checkout/README.md","docs/roadmap/checkout/use-case/README.md","docs/feature/checkout/use-case/README.md"]}
   ```

## 结果

采用复制 Roadmap 的全部 Markdown 页面，集合内的相对链接改为指向新副本，集合外的链接保持原目标，当前的 promotion 一起迁移。新 Feature 成为当前契约。原 Roadmap 保留，`roadmap show` 的 metadata 变为 `"state":"adopted"`、`"adoptedAs":"docs/feature/checkout/README.md"`。

以下情况拒绝，不留下部分写入：同类 ID 重复、嵌套 owner、非 Markdown 附件、symlink、目标路径冲突、无法安全改写的链接，以及采用过程中源文件被修改。Design 只允许一次裁决，裁决方式见[逐项比较方案并明确裁决](compare-design-plans.md)。

## 路径与身份

- 实际路径是文档的身份。`metadata.id` 与文件名分开维护，创建时默认用 ID 命名。
- Feature、Roadmap、Design 与 Engineering 位于各自分类下的单层目录，入口是 `README.md`。Use Case 位于所属 Feature 的 `use-case/` 目录。Issue 是 `docs/issues/` 下的 `.md` 文件。Research 可以嵌套主题，Memory 的路径在其来源内确定。
- 短 ID 只用于唯一查询。同一类别（Memory 除外）的 ID 不能重复，Memory 重名时用完整路径。
- 创建子文档、采用、保存页面、关系与证据都使用实际路径，发布和恢复不会按 ID 重新猜路径。移动文件后，绑定原路径的证据不会自动对新路径有效。
- 附页可以按精确路径或 anchor 归到所属 Feature，相邻 package 不会因目录名前缀相似而混入。

## 名称

文档 ID、Design 候选名和自定义专题名支持 Unicode 字母、组合标记和数字，可以用单个连字符分隔。

```sh
concord use-case create 扩展NPC动作 --feature npc --title "扩展 NPC 动作"
concord feature page add npc 认知与执行
```

前者生成 `use-case/扩展NPC动作.md`，后者生成 `认知与执行.md`。名称保留原样，不翻译，不改大小写，也不做 Unicode 规范化。不允许空白、控制字符、路径分隔符、点段和引用分隔符。CLI、高级治理、页面编辑与 Web 使用同一套校验。

## Memory 来源中的其它文档

Memory 来源中能严格解码的其它类别文档是只读历史材料。它们不进入现行契约关系，也不会被改写成 Memory。Web 保留原文与原目录，现行关系指向这些材料时仍然拒绝。格式错误和放错位置的 owner 继续报告诊断。

## 契约来源

- 页面写法：`concord --skill document`
- 命令总览：[CLI](../cli.md#创建契约)
