# 全局术语

本页定义适用于整个 docs 的术语。每个二级标题是一个概念：标题文字是正文中唯一的写法，第一段是定义。

## Spec {#spec}

产品或工程的目标、行为、约束与验收要求。

旧写法：`契约`

## Memory {#memory}

开发中可复用的经验：测量结论、根因、踩过的坑和做过的取舍。过时就改写或删除。

旧写法：`工程记忆`

## Issue {#issue}

还要处理的缺陷、请求或观察。处理完就删除。

## Feature {#feature}

一项产品能力的 Spec，位于 `docs/feature/<id>/`，由 README、Use Case、cli 或 library 页和 architecture 页组成。

README 告诉第一次读的人能做什么、怎么开始；字段、错误码与边界写在其它页面（[读得懂胜过写得全](taste.md#t-1)）。

## Use Case {#use-case}

一个使用者为达成一个目标走过的完整路径，写明起始状态、逐步动作、看到的结果和验收条件。

## Design {#design}

多个可行方案并存时的决策记录：在共同目标与限制下比较候选方案，写下选择和理由。采用的规则写回 Spec，Spec 只把 Design 链接为决策依据。

## Roadmap {#roadmap}

尚未采用的产品方向，按 Feature 的体裁书写；采用后移入 `docs/feature/`，实现与测试不指向它。

## 品味 {#taste}

项目判断“什么是好的”的共同标准：一句话写清它偏好什么，说明它解决的问题，并给出好的样子与坏的样子。规则写不到的地方按品味选择，审阅时按品味判断好坏。

品味写在一个文件里，每个条目有稳定 ID，依据它的句子旁链接该 ID；修改历史由 Git 保存。

## 条目 {#entry}

品味文件中带 ID 的一条品味。依据它的句子旁链接它的 ID。

## owner {#owner}

唯一维护某项事实的文件或目录。其它页面链接 owner，不复制它的内容；反向关系从 owner 推导。

## 项目目录 {#project-directory}

一次 Concord 操作所针对的项目根目录。从命令所在的当前目录定位，也可以通过 `--root` 显式选择；同一项目的子目录指向同一个项目目录。

项目目录与分支策略无关。在原目录切换分支仍是同一个项目目录，另一个检出目录是独立的项目目录。

## 工作区服务 {#workspace-server}

为一个项目目录提供缓存、查询与 Web 连接的本地服务。同一项目目录最多一个实例，CLI 可以在没有该服务时独立执行。

## 写作指南 {#writing-guide}

随安装包提供、告诉 agent 怎样为项目写第一批 Spec 的 skill 主题。`docs-from-scratch` 面向还没有代码的项目，`docs-from-code` 面向已有代码的项目。

## 标记 {#marker}

测试源码里指向 Spec 的 Concord 注释，例如 `@use-case`。测试与 Spec 的关联只由标记建立。

## 代码声明 {#code-declaration}

实现源码里经过校验、指向 Spec 的 Concord 注释，例如 `@concord-implements`。它表示实现关联，不证明 Spec 已经完成。

## trace {#trace}

从标记和代码声明推导出的关系图，连接 Spec、测试与实现。它不另存登记表，每次从源码重新推导。

## 关系 {#relation}

Issue 或 Memory 指向另一个文档的一条带角色的链接，写在 frontmatter 的 `relations` 中。角色说明这条链接的意思；Issue 的角色见 [Issue 字段](feature/feedback/architecture.md#issue-字段)，Memory 的角色见[文档模型](document-model.md#memory)。

## 修复核验 {#fix-verification}

把缺陷 Issue 关为已修复之前的核验：回归测试在缺陷提交上失败、在修复提交上通过；通过后删除 Issue，结论输出给提交说明。它只证明这一条命令的结果，不证明测试覆盖。

## 门禁 {#gate}

交付前必须全部通过的检查。Concord 的聚合门禁是 `concord check`。

## 投影 {#projection}

从权威输入生成的结构化表示，保留来源身份与来源摘要，不拥有独立的领域事实或授权结论。

## 快照 {#snapshot}

某一时刻读取到的一组来源内容及其摘要。基于快照得出的结论只对这组内容成立。

## 租约 {#lease}

写入者在提交期间对工作区写入的短期独占占用。同一 worktree 同时只有一个持有者；持有者异常退出后，由恢复回收。

## 发布 {#publication}

把已经写好的文档改动、投影、缓存或构建产物整体换成可见状态，例如在[租约](#lease)下按 journal 逐文件原子 rename。中途失败时旧状态不变。

发布只指本地状态的整体替换，例如文件发布、发布投影与 Web 产物的原子发布；软件的版本交付是[发版](#release)。

## 发版 {#release}

软件的版本交付：打标签、构建归档、上传到 GitHub Release，并更新 Homebrew、Nix 与 Herdr 渠道。

例如从标签发版、发版工作流与发版前验证。`GitHub Release` 与代码里的 `release` 是平台名和标识符，照原样书写。
