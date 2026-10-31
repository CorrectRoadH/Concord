---
deprecated:
  spec: [契约]
  memory: [工程记忆]
---

# 全局术语

本页定义适用于整个 docs 的术语。每个二级标题是一个概念：标题文字是正文中唯一的写法，第一段是定义。

## Spec {#spec}

产品或工程的目标、行为、约束与验收要求。

## Memory {#memory}

保存调查经过、根因、裁决及可复用经验，并维护其生命周期与证明关系的工程知识。

## Issue {#issue}

等待调查的问题、摩擦或请求，拥有观察描述、调查关联与本地处理状态。

## Feature {#feature}

一项产品能力的 Spec，位于 `docs/feature/<id>/`，由 README、Use Case、cli 或 library 页和 architecture 页组成。

README 告诉第一次读的人能做什么、怎么开始；字段、错误码与边界写在其它页面（[读得懂胜过写得全](constitution.md#c-017)）。

## Use Case {#use-case}

一个使用者为达成一个目标走过的完整路径，写明起始状态、逐步动作、看到的结果和验收条件。

## Design {#design}

多个可行方案并存时的决策记录：在共同目标与限制下比较候选方案，写下选择和理由。采用的规则写回 Spec，Spec 只把 Design 链接为决策依据。

## Roadmap {#roadmap}

尚未采用的产品方向，按 Feature 的体裁书写；采用后移入 `docs/feature/`，实现与测试不指向它。

## 品味 {#constitution}

项目判断“什么是好的”的共同标准：一句话写清它偏好什么，说明它解决的问题，并给出好的样子与坏的样子。规则写不到的地方按品味选择，审阅时按品味判断好坏。

品味与底线写在同一个文件里，每个条目有稳定 ID，依据它的句子旁链接该 ID，每次修改附一条记下理由的 Decision Memory（[总则](constitution.md#general-amend)）。

## 底线 {#floor}

不得违反的硬约束。每款是一项“必须”或“不得”，违反即阻止交付。

## 条目 {#entry}

品味文件中带 ID 的一条品味或一条底线。依据它的句子旁链接它的 ID。

## owner {#owner}

唯一维护某项事实的文件或目录。其它页面链接 owner，不复制它的内容；反向关系从 owner 推导。

## 标记 {#marker}

测试源码里指向 Spec 的 Concord 注释，例如 `@use-case`。测试与 Spec 的关联只由标记建立。

## 代码声明 {#code-declaration}

实现源码里经过校验、指向 Spec 的 Concord 注释，例如 `@concord-implements`。它表示实现关联，不证明 Spec 已经完成。

## trace {#trace}

从标记和代码声明推导出的关系图，连接 Spec、测试与实现。它不另存登记表，每次从源码重新推导。

## 修复核验 {#fix-verification}

把缺陷 Issue 关为已修复之前的核验：回归测试在缺陷提交上失败、在修复提交上通过，结论写入 Issue。它只证明这一条命令的结果，不证明测试覆盖。

## 门禁 {#gate}

交付前必须全部通过的检查。Concord 的聚合门禁是 `concord check`，CI 对每次变化另外运行 `concord check --since <base>`。

## 投影 {#projection}

从权威输入生成的结构化表示，保留来源身份和代次，不拥有独立的领域事实或授权结论。

## 快照 {#snapshot}

某一时刻读取到的一组来源内容及其摘要。基于快照得出的结论只对这组内容成立。

## 代次 {#generation}

单调递增的状态序号：每接受一次新的来源发布或投影结果就加一。读取前后代次相同，说明读取期间没有新的状态被接受。

## 租约 {#lease}

写入者在提交期间对工作区写入的短期独占占用。同一 worktree 同时只有一个持有者；持有者异常退出后，由恢复回收。
