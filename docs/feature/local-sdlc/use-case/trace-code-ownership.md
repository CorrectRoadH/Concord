---
format: concord.document/v1
id: trace-code-ownership
title: 从源码追踪实现归属
createdAt: 2026-09-13T14:47:27.123Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 从源码追踪实现归属

## 场景

维护者希望直接在整文件、函数或完整代码段旁声明其关联的 Feature / Use Case / Engineering，并从契约反查实现、从文件位置查询关联，不必另外命名声明 ID。声明表达维护者的实现意图，不证明完成或测试覆盖。

## 主流程

1. 在 concord.config.ts 配置 sourceRoots，或新项目用 init --source-root src；缺省不扫描实现源码。
2. code annotate --scope file|node|region --contract <canonical-ref> 生成无 ID 注释，多目标重复 --contract；维护者把片段放到实际源码。file/code/begin/end 标记均无参数，implements 保留显式引用。
3. code list 返回当前声明；code locate <path> --line <n> 返回该行所有包含作用域。生成片段无需身份，使用者按符号与源码位置查看实现。
4. trace show <feature-or-use-case-or-engineering> 汇总代码 implements 边；review render 分别列出代码和测试。Web 以符号、文件位置和关联契约展示，不再要求输入或显示声明 ID。
5. 修改、移动、删除源码后按当前字节重新核对。未改文件的声明解析可以来自可丢弃投影；查询不维护第二份关系 JSON，关系仍从当前 Markdown 派生。

## 验收

- 文件头、支持的完整函数/声明、同一语句列表内的非空连续代码段均可标注；一个作用域最多一份声明，多契约重复 implements。当前引用由 canonical 路径、scope 与 AST 结构位置派生，无登记表或写回步骤，重复引用仍产生 finding。
- 在定位路径和同描述前序兄弟不变时，空白、行号、普通函数体和 implements 修改不改变 node 引用。同内容新进程/clone 结果一致；同名、匿名、未标注兄弟与嵌套作用域按完整 AST 区分。固定元组、名称和版本规则见[采用设计](../../../design/derived-code-reference/plans/derived/architecture.md)。
- 引用是当前定位而非永久历史身份；文件移动、改名、作用域或顺序改变可能使引用失效或复用。删除同列表 region A 的标记后，后续 B 可以复用 A 的旧引用。自动消费者重新 list/locate 并核对文件、符号和范围，不能把成功查询视为历史连续性证明。
- 源码中的字符串、模板、正则和 JSX 文本不产生伪声明；未知标签、重复作用域、缺失目标、错误边界和标注文件的语法错误均产生 finding。
- 范围标记不接受参数，按当前语法校验，无兼容分支或迁移专用诊断。无效 begin 也参与边界配对，不允许跳过后让 end 消耗外层 begin。普通扫描不改写源码。
- 不提供按声明 ID 查询的命令、身份输入或复制 ID 界面；图关系使用内部派生引用。
- 引用支持 Feature / Use Case / Engineering owner、Feature 或 Engineering supporting page 与有效 anchor，保留 exactRef；Feature 反查包含其 Use Case，Engineering 不拥有 Use Case 子树，按自动查询引用去重。
- 文件、函数与代码段可完整包含；region 不可嵌套，跨函数/半表达式/空 region 被拒绝。查询返回所有包含的显式作用域，不推断继承、优先级或完成度。
- sourceRoots 可选且遵循既有安全路径边界。代码标注错误阻断代码及全图命令，但不新增测试执行或 Problem fixed 的前置条件；既有真实测试、候选摘要和 red/green 证据校验继续生效。
- JS/TS 首版仅支持明确的 AST 节点，见 concord --skill code；不对其他语言宣称支持。
