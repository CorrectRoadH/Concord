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
3. HawDB 以项目、路径集合、文件摘要、runner 配置和解析器版本作为身份；有效缓存命中才复用投影。
4. 文件修改、重命名、删除、配置变化或缓存损坏时从权威源码重建。

## 验收

- `concord.config.ts` 的可选 `sourceIgnore: readonly string[]` 默认 `[]`。每项是区分大小写的仓库相对文件或目录路径，目录包含其子树；不接受绝对路径、空段、`.`、`..`、反斜杠、控制字符或 glob（`*?[]{}!`）。配置严格解码，不读取被忽略路径来验证其存在性。
- 例如 `sourceIgnore: ['games/ljkx/generated', 'tests/fixtures/vendor']` 同时约束 sourceRoots 与 testRoots 的自动发现。忽略在访问条目之前执行，断链也可排除。显式来源根优先：根自身和包含该根的忽略项不排除该根内的发现；根内更具体的忽略项仍生效。
- 扫描、目录观察复核与工作台监听使用相同路径匹配；配置改变使旧快照失效，并重新计算监听范围。文档、Memory、runner.sourceFiles 与显式读写不受 sourceIgnore 影响，配置不是诊断错误过滤器。

- 源码自动发现按路径段排除 `.env`、`.env.*` 与 `dist`，不读取、解析或跟随环境文件及生成产物；规则独立于 Git ignore。普通文件、符号链接和断链采用相同的排除规则。显式指定的来源根不受子目录发现规则排除，其自身仍须通过安全校验。
- 代码、测试与工作台源码清单共用此规则；目录快照复核保留同一发现范围。被排除条目的变化不影响源码快照，候选源码的新增、删除与类型变化仍须复核。
- 排除只作用于源码自动发现。文档清单、显式引用、指定来源根和读写路径继续执行既有路径安全校验；候选源码中的符号链接仍具名拒绝。

- JS/TS 字符串或模板中的伪注释不注册 case。其它语言里单独成行、且以注释前缀开头的标记会注册。
- 缺值、重复契约目标、以及缺少契约的标记产生明确 finding。不认识的测试写法不产生 finding。
- `@status retired` 不能用于 fixed 证据。工具不从测试语法推断 skip 或待办状态。

每个标记只选择一个契约目标；多个标记可关联同一 Feature 或 Use Case。工具从文件和标记派生执行引用，不需要人工维护 ID。
