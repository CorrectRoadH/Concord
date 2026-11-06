# 全局术语表

本页定义适用于整个 docs 的概念。每个二级标题是一个概念：标题文字是正文中唯一的写法，第一段是定义。

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

品味写在一个文件里，每个品味条目有稳定 ID，依据它的句子旁链接该 ID；修改历史由 Git 保存。

## 品味条目 {#entry}

品味文件中带 ID 的一条品味。依据它的句子旁链接它的 ID。

旧写法：`条款`

## 概念 {#concept}

`concepts.md` 中一个二级标题定义的领域名词，包括唯一的写法、稳定 ID、定义与[旧写法](#deprecated-name)。

写法是概念在正文中的字符串；改名时 ID 不变。

## 术语表 {#glossary}

一份 `concepts.md` 及它在所在目录与子目录中生效的概念集合。全局术语表就是本页，对整个检查范围生效。

## 旧写法 {#deprecated-name}

概念定义后“旧写法：”一段列出的弃用写法。正文出现旧写法时，检查报告它并给出概念的现行写法。

旧写法：`弃用名`、`旧名字`

## 写作规则 {#writing-rules}

`writing.md` 声明的句长与段长上限、不用的词和检查范围，对所在目录及其子目录生效。

旧写法：`写作政策`

## owner {#owner}

唯一维护某项事实的文件或目录。其它页面链接 owner，不复制它的内容；反向关系从 owner 推导。

owner 只指文件或目录。持有租约或刷新的进程是[持有者](#holder)；组织或作用域对仓库的关系写“归属”或“拥有”。

## 文档包 {#package}

Feature、Engineering 或 Roadmap 的一个目录，以 `README.md` 为入口，包含按页面种类命名的页面；身份由路径决定。

## 项目目录 {#project-directory}

一次 Concord 操作所针对的项目根目录。从命令所在的当前目录定位，也可以通过 `--root` 显式选择；同一项目的子目录指向同一个项目目录。

项目目录与分支策略无关。在原目录切换分支仍是同一个项目目录，另一个检出目录是独立的项目目录。

## 工作区服务 {#workspace-server}

为一个项目目录提供缓存、查询与 Web 连接的本地服务。同一项目目录最多一个实例，CLI 可以在没有该服务时独立执行。

## 写作指南 {#writing-guide}

随归档提供、告诉 agent 怎样为项目写第一批 Spec 的 [skill 主题](#skill-topic)。`docs-from-scratch` 面向还没有代码的项目，`docs-from-code` 面向已有代码的项目。

## skill 主题 {#skill-topic}

`concord --skill <主题>` 输出的一份随归档提供的说明；写作指南与工作流 skill 读取的都是它。

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

交付前必须全部通过的检查。

## 合并检查 {#combined-check}

`concord check` 一次运行的关系检查与写作检查，作为交付前的检查。

旧写法：`聚合检查`、`聚合门禁`

## finding {#finding}

检查给出的一条带具名 code、路径与类别的问题；存在 finding 时检查不通过。

advisory 是不使检查失败的提示，不算 finding。原生诊断与缓存诊断是工具产生的输入，经检查归类后才成为 finding。

## 投影 {#projection}

从权威输入生成的结构化表示，保留来源身份与来源摘要，不拥有独立的领域事实或授权结论。

## 快照 {#snapshot}

某一时刻读取到的一组来源内容及其摘要。基于快照得出的结论只对这组内容成立。

## 漂移 {#drift}

读取开始到返回之间，读过的文件字节或目录成员发生变化。有漂移的结果不作为结论发布。

## 前像 {#preimage}

写入前观察到的目标文件内容：字节、摘要与 mode，或“不存在”。发布与恢复只在当前内容等于前像时才替换。

编辑器打开文件时读到的内容是这次编辑的前像，称编辑前像；保存时用它判断文件是否被别人改过。

## 草稿 {#draft}

编辑器中尚未写回文件的修改。文件被别人改过时保存被拒绝，草稿保留。

## 保存冲突 {#save-conflict}

保存时文件的当前摘要与[编辑前像](#preimage)不同。保存不覆盖文件，保留草稿并显示差异。

## 租约 {#lease}

写入者在提交期间对工作区写入的短期独占占用。同一 worktree 同时只有一个[持有者](#holder)；持有者异常退出后，由[恢复](#recovery)回收。

## 持有者 {#holder}

当前持有租约的进程，由持有者文件中的 token、PID 与主机标识。刷新等其它独占占用的持有进程也叫持有者。

## journal {#journal}

一次写入在发布前记录的计划，包含每个目标的[前像](#preimage)、计划摘要和当前阶段。中断后由恢复按它完成或回滚。

旧写法：`文件事务`、`写入日志`

## 恢复 {#recovery}

`concord recover` 在独占保护下核对 journal 与 runner 状态，完成或回滚中断的发布，并回收已死亡持有者的 token。

## 发布 {#publication}

把已经写好的文档改动、投影、缓存或构建产物整体换成可见状态，例如在[租约](#lease)下按 journal 逐文件原子 rename。中途失败时旧状态不变。

发布只指本地状态的整体替换，例如文件发布、发布投影与 Web 产物的原子发布；软件的版本交付是[发版](#release)。

## 发版 {#release}

软件的版本交付：打标签、构建[归档](#archive)、上传到 GitHub Release，并更新 Homebrew、Nix 与 Herdr 渠道。

例如从标签发版、发版工作流与发版前验证。`GitHub Release` 与代码里的 `release` 是平台名和标识符，照原样书写。

## 归档 {#archive}

一个目标平台的 `concord-<version>-<target>.tar.gz`，内含启动脚本、固定版本的 Node.js 运行时、构建好的应用、原生绑定与 ripgrep；所有渠道都从它安装。

解压后的目录是安装目录。

## 原生绑定 {#native-binding}

随归档发版的、目标平台专用的 HawDB N-API 引擎文件；加载前与 native manifest 核对身份。

旧写法：`原生 addon`

原生绑定与 macOS 的 `rg` 等目标平台专用文件统称原生产物。

## 安装身份 {#installation-identity}

安装目录内全部 JS 与原生产物的内容摘要，用来判断客户端与工作区服务是否属于同一份程序。

## 图解 {#diagram}

Spec 中说明过程或结构的图：p5 动画说明随时间变化的过程，Mermaid 结构图说明静态结构。
