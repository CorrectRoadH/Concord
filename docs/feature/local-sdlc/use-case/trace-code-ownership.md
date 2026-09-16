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

维护者希望直接在整文件、函数或完整代码段旁声明其关联的 Feature / Use Case，并从契约反查实现、从文件位置查询关联。声明表达维护者的实现意图，不证明完成或测试覆盖。

## 主流程

1. 在 concord.config.ts 配置 sourceRoots，或新项目用 init --source-root src；缺省不扫描实现源码。
2. code annotate <id> --scope file|node|region --contract <canonical-ref> 生成注释，多目标重复 --contract；维护者把片段放到实际源码。
3. code list/show 检查声明，code locate <path> --line <n> 返回该行所有包含作用域。
4. trace show <feature-or-use-case> 汇总代码 implements 边；review render 分别列出代码和测试。
5. 修改、移动、删除源码后查询重新扫描，不维护第二份关系 JSON。

## 验收

- 文件头、支持的完整函数/声明、同一语句列表内的非空连续代码段均可标注；ID 在当前 code 命名空间唯一，一个作用域一个 ID，多契约重复 implements。
- 源码中的字符串、模板、正则和 JSX 文本不产生伪声明；实际注释里的非法 ID、未知标签、重复作用域、缺失目标、错误边界和标注文件的语法错误均产生 finding。
- 引用支持 Feature / Use Case owner、Feature supporting page 与有效 anchor，保留 exactRef；Feature 反查包含其 Use Case，按声明 ID 去重。
- 文件、函数与代码段可完整包含；region 不可嵌套，跨函数/半表达式/空 region 被拒绝。查询返回所有包含的显式作用域，不推断继承、优先级或完成度。
- sourceRoots 可选且遵循既有安全路径边界。代码标注错误阻断代码及全图命令，但不新增测试执行或 Problem fixed 的前置条件；既有真实测试、候选摘要和 red/green 证据校验继续生效。
- JS/TS 首版仅支持明确的 AST 节点，见 concord --skill code；不对其他语言宣称支持。
