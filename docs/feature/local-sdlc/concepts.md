# 本地 SDLC 闭环术语表

本页定义 Spec、测试与实现关联中的概念。[全局术语表](../../concepts.md)中的[标记](../../concepts.md#marker)与[代码声明](../../concepts.md#code-declaration)自动适用于本目录。

## 步骤 {#step}

Use Case 完整路径中可以被测试和实现指向的一步：正文根节点直接拥有的有序列表项，第一段末尾带 `{#id}`。

引用形式是 `<use-case 路径>#<id>`，语法见[步骤语法](format.md#步骤语法)。没有 `{#id}` 的列表项不是步骤。

## 短选择器 {#short-selector}

代替完整路径选择文档的短名：Feature 目录名、Use Case 文件名、Issue 或 Memory 文件名。同一类别中有歧义时具名拒绝，要求写出路径。

旧写法：`短 ID`

## 测试根 {#test-root}

Concord 扫描测试标记的目录。默认取存在的 `test/` 与 `tests/`，由 `concord.config.ts` 的 `testRoots` 覆盖。

## 源码根 {#source-root}

Concord 扫描代码声明的目录。默认取存在的 `src/`，由 `concord.config.ts` 的 `sourceRoots` 覆盖。

测试根与源码根合称发现范围。

## adapter {#adapter}

项目在 `testAdapters` 中为一部分测试文件配置的收集适配器：列出框架认识的具体用例、label、身份与来源位置。Concord 将清单与源码标记绑定，用于查看和查找关联缺口。

adapter 不派发测试体，不解析测试执行报告。未被覆盖的文件仍可使用静态标记；其原生用例集合未知。

## 原生用例 {#native-case}

测试框架报告的一个测试或参数展开项，以带 provider 命名空间的 `nativeId` 标识。它与源码标记派生的测试关联身份分别展示。

## label {#label}

框架报告的用例分类元数据，例如 pytest mark 或 JUnit Tag。协议用 `tags` 保存它们，缺失能力时报告缺口。label 不自动成为 Spec 关系；具体用例通过来源范围或显式 `@native` 绑定到源码标记。

## 标记块 {#marker-block}

源码中一组连续的 Concord 标记行，恰有一个 Spec 目标。每个标记块是一个 case，标记序号按标记块计数。
