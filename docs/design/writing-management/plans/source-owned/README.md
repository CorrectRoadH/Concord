# source-owned

> 此历史方案的固定路径和 Markdown 术语来源边界已由[目录作用域方案](../../../scoped-terminology/README.md)替代。原裁决及论证保留为历史，不再定义当前范围。

## Problem

规则的混合职责与重复条目阻碍作者理解、修改和验证写作政策。

## Core Mental Model

禁用表达由政策 JSON 拥有；首选术语由 concepts Markdown 拥有；命中随当前输入派生。

## Scope

浏览器管理、服务端校验与检查；不负责产品 API 语义或自动正文替换。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-safe-publication) | satisfied | 固定路径、具名写入和 CAS 日志 | 架构论证，不代表验收 |
| [L2](../../LIMITS.md#l2-preserve-sources) | satisfied | 概念原文继续拥有事实，JSON 不复制首选词 | 当前 concepts 与写作规则双来源 |
| [L3](../../LIMITS.md#l3-honest-checks) | satisfied | 只读检查，不生成执行证明 | 文档检查契约 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-clear-ownership) | satisfied | 按来源呈现手写与派生规则 | 候选架构论证 |
| [G2](../../GOALS.md#g2-web-authoring) | satisfied | 显式保存、冲突保留草稿和按需检查 | 浏览器交互设计，待实测 |

## Entry Points

`/writing` 提供写作与术语入口。CLI 结构化 action 与 Web 共用领域操作。

## Publication and recovery

`writing.show` 只读固定 `docs/concord-writing.json`，返回政策及整文件 digest；不存在返回空态。`writing.set` 严格接受政策和 expectedDigest（缺失文件为 null），只发布该固定路径。`writing.check` 使用当前固定政策运行扫描；CLI 的 `docs check --rules` 仍可只读其它文件，但 Web 不授权写其它路径。

增加固定文档 owner，但 publication 与 recovery 都需校验 operation 为 set-writing-policy、唯一 change 为固定路径、after 非空且通过严格政策解码；配置摘要、before/after 与目录限制复用现有 journal。修复错误政策可以保留任意旧 bytes 作为 before，但新 after 必须有效。prepared 回退旧值，committed 保留新值，未知编辑拒绝。旧程序遇到未完成的新规则事务必须拒绝恢复；升级程序完成 recover 后方可回退，不能扩大旧授权。

Web 使用结构化表单，显式保存；保存失败保留草稿，切页/卸载遵守现有未保存保护。删除条目是政策编辑，不是自动禁用检查。概念派生规则只读并链接现有 concepts 编辑页。原文件读取失败不伪装成空库。结果包含输入摘要或其他可验证的时效标记；政策保存或检查输入变化后不能继续标记为当前通过。

规则 format 保持本轮新建的 concord.writing/v1，字段严格；不读取 NiceEval 旧文件。没有 SQLite 表、sidecar 或人工词条 ID，条目规范化写法只用于当前列表和重复检测，不充当持久身份。

## Adopted challenge conditions

1. 共用 preflight 双向限制：set-writing-policy 只能操作固定政策路径；任何含该路径的事务也只能是此操作，恰好一个 change、非空 after，并经过 readWritingPolicy 完整结构和语义校验。测试覆盖伪造 operation、第二文件、删除、无效 after、配置变更和未知编辑。升级前的旧程序对 prepared、committed 事务都应拒绝恢复且保留现场；新程序先恢复再回退。
2. writing.show 返回 missing / valid / invalid。格式错误但安全读取成功时返回原文、digest 和诊断，允许显式用有效政策修复；读取、安全、大小错误不变成空态。恢复允许 before 是原来的无效内容。
3. Web 与扫描器共用术语解释，显示来源路径和行号。每个语言列的同义词组独立保存首选映射，不能后一列覆盖前列。手写与派生规则的重叠或矛盾显式呈现双方来源，不静默选择，不复制派生项。非受管 concepts 路径仅只读显示，不扩大 Markdown 写授权。
4. 检查只针对已保存磁盘输入；结果带覆盖政策、配置、文件集合和正文、概念的快照摘要，命中上下文来自同次内容。界面始终称为“某次快照的检查结果”，不显示“当前通过”。草稿编辑、保存与新检查使旧报告失效；过期异步响应不能重新激活旧报告。
5. 显式保存的表单独立注册脏草稿保护，导航 flush 不得触发保存。冲突保留原草稿与原摘要，后台刷新不覆盖。保存返回实际已提交政策与摘要；请求中出现的新编辑保留为未保存。测试覆盖双标签冲突、保存时继续编辑、取消离开与主动放弃。
6. Feature、policy 与架构同步固定路径写入授权，--rules 只读其它路径。采用适用 c-003；不修订宪法，不把设计挑战视作实现验收。
