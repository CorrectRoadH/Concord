---
format: concord.document/v1
id: discover-annotated-tests
title: 发现测试并重建缓存
createdAt: 2026-09-13T11:00:35.003Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 发现测试并重建缓存

## 用户目标

测试维护者在任意语言的测试文件里写一行注释，把测试关联到 Feature 或 Use Case。Concord 从这些注释发现测试，不解析测试框架的语法。缓存损坏或被删除时，结果仍以源码为准。

## 起始状态

- `concord.config.ts` 的 `testRoots` 指向测试目录，例如 `["test"]`。
- 要关联的 Feature 或 Use Case 已存在。

## 完整路径

1. 生成标记。 {#annotate}

   ```sh
   concord test annotate --contract docs/feature/cart/use-case/add-item.md
   ```

   ```text
   // @use-case docs/feature/cart/use-case/add-item.md
   ```

   `--regression memory/<id>.md` 追加 `@regression` 行。需要可读名称时，在标记块里手写 `@name <text>`。契约或 Problem 不存在时返回 `ReferenceNotFound`。

2. 把标记放在测试声明上方。注释前缀可以是 `//`、`#` 或 `--`。 {#place}

   ```js
   // @use-case docs/feature/cart/use-case/add-item.md
   test('adding the same sku twice sums the quantity', () => { ... });
   ```

3. 列出测试。 {#list}

   ```sh
   concord --json test list
   ```

   ```json
   {"operation":"test-list","cases":[{"id":"neref_854212737ecad7effc4666629752cb98","file":"test/cart.test.js","line":5,"name":"docs/feature/cart/use-case/add-item.md#0","contract":"docs/feature/cart/use-case/add-item.md","contractKind":"use-case","regressions":[],"status":"active","framework":"marker","skipped":false,"named":false,"markerEndLine":5}],"observations":[]}
   ```

   每个标记块是一个 case。`id` 由文件与标记位置派生，不需要手写。`concord --json test show <id>` 返回单个 case，附 `evidenceScope` 与 `analysis`。

4. 删除缓存后再次列出。 {#rebuild}

   ```sh
   concord cache clear
   concord --json test list
   ```

   结果与第 3 步相同。`concord --json cache status` 在缓存可用时返回 `{"status":"ready",...}`。

## 结果

`test list`、`test show` 与 `check` 返回当前源码里的全部标记。修改、改名或删除测试文件后，下一次查询立即反映变化。

标记写错时，`check` 退出 1 并给出带文件和行号的 finding：

| 情况 | 结果 |
| --- | --- |
| 标记缺少契约路径，或一个标记块有两个契约 | finding，指向标记所在行 |
| 契约文件不存在 | `ReferenceNotFound` |
| JS/TS 字符串或模板里出现的标记文本 | 不注册 case |
| Concord 不认识的测试写法 | 不产生 finding |

## 标记规则

- 每个标记块只选一个契约。多个标记块可以关联同一个 Feature 或 Use Case。
- `@status retired` 表示测试已退役，不能用于关闭 Problem。
- 工具不从测试语法推断跳过或待办状态。

## 忽略路径

`concord.config.ts` 的可选 `sourceIgnore` 排除不需要扫描的路径，默认 `[]`。

```ts
sourceIgnore: ['games/ljkx/generated', 'tests/fixtures/vendor']
```

- 每项是区分大小写的仓库相对文件或目录路径，目录包含其子树。
- 不接受绝对路径、空段、`.`、`..`、反斜杠、控制字符和 glob 字符（`*?[]{}!`）。配置严格解码，不检查被忽略的路径是否存在。
- 同时作用于 `sourceRoots` 与 `testRoots` 的自动发现。断链也能被排除。
- 显式配置的来源根优先：根自身和包含该根的忽略项不排除根内发现，根内更具体的忽略项仍然生效。
- 扫描、目录复核与工作台监听使用同一套匹配。配置改变后旧结果失效，监听范围重新计算。
- 文档、Memory、`runner.sourceFiles` 和显式读写不受 `sourceIgnore` 影响。它不是诊断过滤器。

不论是否配置，自动发现都按路径段排除 `.env`、`.env.*` 与 `dist`，不读取、不解析、不跟随这些路径，规则与 Git ignore 无关。普通文件、symlink 与断链按同一规则排除。显式指定的来源根不受这条排除规则影响，但仍要通过路径安全校验。这条规则只作用于源码自动发现。候选源码中的 symlink 仍然具名拒绝。

## 契约来源

- 命令与输出：[CLI](../cli.md#测试与证据)
- 缓存身份与重建：[架构](../architecture.md#编译管线)
