---
format: concord.document/v1
id: discover-annotated-tests
title: 发现测试并重建缓存
createdAt: 2026-09-13T11:00:35.003Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 发现测试并重建缓存

## 场景

作为测试维护者，我希望在任意语言的测试文件里用 `@feature` 或 `@use-case` 标记关联契约，可选 `@regression` 与 `@name`，并让查询在缓存损坏时仍以源码为准。

## 主流程

1. 用 `test annotate` 验证契约目标和 Problem 引用，把输出片段放进测试文件。`//`、`#` 和 `--` 都是标记。
2. `test list/show` 或 `check` 扫描配置的 testRoots。标记存在即是 case，不解析宿主测试语法。
3. SQLite 以项目、路径集合、文件摘要、runner 配置和解析器版本作为身份；有效缓存命中才复用投影。
4. 文件修改、重命名、删除、配置变化或缓存损坏时从权威源码重建。

## 验收

- JS/TS 字符串或模板中的伪注释不注册 case。其它语言里单独成行、且以注释前缀开头的标记会注册。
- 缺值、重复契约目标、以及缺少契约的标记产生明确 finding。不认识的测试写法不产生 finding。
- `@status retired` 不能用于 fixed 证据。工具不从测试语法推断 skip/todo。

每个标记只选择一个契约目标；多个标记可关联同一 Feature 或 Use Case。工具从文件和标记派生执行引用，不需要人工维护 ID。
