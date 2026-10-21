# 列表项 anchor

## Entity Ownership

步骤由 Use Case 正文拥有；测试关联由测试标记拥有，代码关联由代码声明拥有。四种身份与 `Observation<T>` 直接引用[共同身份](../../共同身份.md)，候选不另定派生版本。

## 步骤与引用

仅从 Markdown AST 正文提取共同契约允许的步骤，不扫描字符串或 fence。验收条目不提供步骤身份。无序、嵌套或其它 owner 中的步骤语法返回 `InvalidStepPosition`。步骤列表与章节语言无关。

每个步骤提取 `id / ref / ordinal / line`；ordinal 是所有合格项在文档中的展示顺序，从 1 计数，不采用作者所写的原始列表数字。ID 与标题显式 ID、slug 及折叠连字符的可接受别名一并做冲突检查，冲突为 `DuplicateAnchor`。

引用继续接受已存在的任意标题 anchor。视图分别展示步骤、整个 Use Case、非步骤 anchor；删除 ID 后拒绝悬空引用，由作者显式修改标记，不进行猜测重定向。Feature 与 supporting page 保留普通标题解析，不增加列表 anchor 解析路径。

## 观察输入

依赖提供者返回共同契约的观察结构，其 value 包含 `scope: file | native-case`、测试关联 ID、可选原生集合与范围身份、已观察声明集合和执行边界。inputs 包含全部源码成员、源码字节、配置、解析实现与版本。

文件级 import 只能证明文件中的声明交集。直接和传递路径中的函数级、文件级声明均可记录；无法解析的辅助函数、动态派发、未声明实现、闭包深度与节点上限、跨进程及网络边界均加入 gaps。不能用 import 成功推断调用图完整。

## Data Flow

1. 当前正文与源码静态重建关系；check 的退出码、finding、complete 不读取观察。
2. 显式 `code analyze` 产生依赖观察；没有当前观察时视图报告 `not-observed` 与 `NoAnalyzer` 或 `SnapshotNotCurrent`。
3. 视图按共同契约匹配 step、use-case、feature 层级，只展示实际观察到的正向交集。文件范围的 `observed` 必须展示 `FileScope` 限定，不声称该文件每个 case 均调用了实现。
4. 未观察到目标交集一律为 `not-observed`，携带 gaps；只观察到其它 Feature 或同 Feature 的另一 Use Case 也不能推导行为无关。
5. 历史观察只带来源、时间展示，不用于当前判定。关联导航无需等待 adapter 或 LSP。

## Invariants

步骤视图、相关性判定和人工校准不写回契约或源码。没有匹配声明不是没有实现的证明；判定不产生 finding，不改变退出码。两条写作路径均剔除真实步骤的末尾 ID，代码示例保持代码处理语义。

## Errors

| 阶段 | code | 行为 |
| --- | --- | --- |
| 步骤位置 | `InvalidStepPosition` | check 报告错误位置 |
| 命名空间 | `DuplicateAnchor` | check 拒绝歧义 |
| 引用 | `AnchorNotFound` | 缺失目标须作者修复 |
| 观察 | gaps | 仅限制展示，不改变门禁 |

## Identity and Reuse

测试关联沿用共同契约的 v1；原生集合和 symbol locator 不进入关联 ID。带 name 的目标变化由 annotation 与 contract 摘要阻止旧证据复用。缓存有无不改变当前关系；可丢弃观察只能在显式命令后重新取得，不能承诺任意外部分析逐字相同。
