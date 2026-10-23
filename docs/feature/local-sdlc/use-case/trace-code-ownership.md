---
format: concord.document/v1
id: trace-code-ownership
title: 从源码追踪实现归属
createdAt: 2026-09-13T14:47:27.123Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 从源码追踪实现归属

## 用户目标

维护者在整个文件、一个函数或一段代码旁写注释，声明它实现哪份 Feature、Use Case 或 Engineering。之后可以从契约查到实现，也可以从源码的某一行查到契约。声明不需要 ID。

声明表达维护者的实现意图，不证明功能完成或测试覆盖。

## 起始状态

- `concord.config.ts` 的 `sourceRoots` 指向实现源码，例如 `["src"]`。新项目可用 `concord init --source-root src`。没有配置时不扫描实现源码。`sourceRoots` 遵守仓库内的路径安全规则。

## 完整路径

1. 生成声明。 {#annotate}

   ```sh
   concord code annotate --scope file --contract docs/feature/cart/README.md
   concord code annotate --scope node --contract docs/feature/cart/use-case/add-item.md
   concord code annotate --scope region --contract docs/feature/cart/README.md
   ```

   ```text
   // @concord-file
   // @concord-implements docs/feature/cart/README.md

   // @concord-code
   // @concord-implements docs/feature/cart/use-case/add-item.md

   // @concord-begin
   // @concord-implements docs/feature/cart/README.md
   // Place complete statements here.
   // @concord-end
   ```

   重复 `--contract` 生成多行 `@concord-implements`。命令只检查指定的契约（以及 `--regression` 给出的 Problem），不读取全项目关系，失败只涉及这些引用。

2. 把声明放进源码。 {#place}

   ```js
   // @concord-code
   // @concord-implements docs/feature/cart/use-case/add-item.md
   export function total(cart) {
     return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
   }

   // @concord-begin
   // @concord-implements docs/feature/cart/README.md
   const EMPTY = {};
   export const empty = () => ({ ...EMPTY });
   // @concord-end
   ```

   - `file`：放在文件头，声明整个文件。
   - `node`（`@concord-code`）：紧贴一个函数、类、方法，或一个初始值为函数的单变量语句。
   - `region`（`@concord-begin` / `@concord-end`）：包住同一语句列表中连续、非空的完整语句。

3. 列出声明。 {#list}

   ```sh
   concord --json code list
   ```

   ```json
   {"operation":"code-list","codes":[
     {"id":"code-62419761eb6ed845430c217d274514ad","file":"src/total.js","line":9,"endLine":10,"scope":"region","contracts":["docs/feature/cart/README.md"]},
     {"id":"code-68054071298e32ca5ef1a72ca3a117d2","file":"src/cart.js","line":1,"endLine":6,"scope":"file","contracts":["docs/feature/cart/README.md"]},
     {"id":"code-a7e4a2ae733e9e2c1e2b3c6da5d636f2","file":"src/total.js","line":3,"endLine":5,"scope":"node","symbol":"total","contracts":["docs/feature/cart/use-case/add-item.md"]}],
    "sourceRoots":["src"]}
   ```

   `line` 与 `endLine` 是代码本身的首行与末行，不含标记行。`id` 由工具派生，不用写进源码。

4. 从源码行查契约。 {#locate}

   ```sh
   concord --json code locate src/total.js --line 10
   ```

   ```json
   {"operation":"code-locate","file":"src/total.js","line":10,"codes":[{"id":"code-62419761eb6ed845430c217d274514ad","file":"src/total.js","line":9,"endLine":10,"scope":"region","contracts":["docs/feature/cart/README.md"]}]}
   ```

   行号从 1 开始。结果包含所有覆盖这一行的声明。

5. 从契约查实现。 {#trace}

   ```sh
   concord --fresh trace show docs/feature/cart/README.md
   ```

   `codeDeclarations` 列出声明，`incoming` 中 `relation` 为 `implements` 的边指向这份契约。Feature 的结果包含其 Use Case 的声明。`review render` 分别列出代码与测试。

## 结果

修改、移动或删除源码后，下一次查询按当前文件内容重新计算。Web 按符号、文件位置和关联契约展示声明，不显示 ID。

`check` 对以下情况给出 finding 并退出 1：

- 未知标签、同一作用域两份声明、契约不存在、`begin` 与 `end` 不配对。
- region 嵌套、跨越函数边界、截断表达式或为空。
- 带声明的文件有语法错误。

字符串、模板、正则和 JSX 文本中的标记文本不算声明。`trace show` 与 `review render` 返回所展示关系的 findings 与 `complete`。`complete` 为 false 或 findings 非空时，依赖完整关系的操作拒绝执行。代码声明错误不影响测试执行，也不改变关闭 Problem 的证据要求。

全局 `check` 逐个文件保留 owner 的解析错误，把它们累计为 findings，返回 `ok: false` 与 `complete: false`。`documents` 数组本身不说明集合是否完整。关闭 Problem、删除 Issue 和迁移关系时同时检查 `complete` 与 findings。

## 声明规则

- 每个作用域最多一份声明，多个契约用多行 `@concord-implements`。
- file、node、region 可以互相包含。查询返回全部包含的声明，不推断继承、优先级或完成度。
- 标记行（file、code、begin、end）不带参数。无效的 `begin` 也参与配对，后面的 `end` 不会去配外层的 `begin`。
- 契约可以是 Feature、Use Case、Engineering，Feature 或 Engineering 的附页，或它们的有效 anchor。
- JS/TS 只支持上面列出的节点，其它语言见 [多语言分析](analyze-other-languages.md)。
- 没有按声明 ID 查询的命令，也不接受 ID 作为输入。

## 引用的稳定性

文件路径不变、前面同类兄弟不变时，空白、行号、函数体和 `@concord-implements` 的修改不改变 node 的引用。同一份内容在新进程或新 clone 中得到相同引用。

引用表示当前位置，不是永久身份。移动、改名、改变作用域或改变同类兄弟的顺序，都可能让引用失效，或者让旧引用指到另一个声明。例如删除前一个 region 的标记后，后一个 region 会接续它的序号。自动化工具每次都要重新 `list` 或 `locate`，核对文件、符号与范围，不能把一次查询成功当作历史连续。引用的派生规则见[采用设计](../../../design/derived-code-reference/plans/derived/architecture.md)。

## 契约来源

- 命令总览：[CLI](../cli.md#关联源码)
- 完整语法：`concord --skill code`
- 精确引用与全局检查：[架构](../architecture.md)
