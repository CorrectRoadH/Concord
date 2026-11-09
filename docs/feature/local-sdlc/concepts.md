# 本地 SDLC 闭环术语表

本页定义 Spec、测试与实现关联中的概念。[全局术语表](../../concepts.md)中的[标记](../../concepts.md#marker)、[代码声明](../../concepts.md#code-declaration)与[修复核验](../../concepts.md#fix-verification)自动适用于本目录。

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

## runner {#runner}

项目在 `concord.config.ts` 中配置的测试执行命令（`argv` 与可选 `timeoutMs`）。Concord 只按它的退出码解释结果。

旧写法：`测试运行器`

测试框架自带的执行器写作原生 runner。GitHub Actions 中执行工作流的机器写作 GitHub runner，不是本概念。

## adapter {#adapter}

项目在 `testAdapters` 中为一部分测试文件配置的原生测试适配器：收集原生用例，并在能证明时精确选择要执行的用例。它的观察不建立关联，也不改变 case 身份。

没有被 adapter 覆盖的测试文件由 runner 执行。

## 冻结命令 {#frozen-command}

修复核验在缺陷提交与修复提交上执行的同一条 runner 命令。两次执行之间，测试、runner 输入与所指 Spec 不变。

它只证明这一条命令在两个提交上的结果，不证明原生测试覆盖或正式 E2E 可靠性。

## 标记块 {#marker-block}

源码中一组连续的 Concord 标记行，恰有一个 Spec 目标。每个标记块是一个 case，标记序号按标记块计数。
