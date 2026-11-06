# TypeScript 代码规范

维护者与 agent 写 `src/`、`web/`、`test/`、`scripts/` 与 `bench/` 时遵守本页。模块怎样分层、谁能依赖谁由[代码结构](architecture.md)规定；本页规定在这些模块里怎样写和怎样命名。规则取自代码中已经占多数的写法，两种写法势均力敌时写明选择的理由。

## 由门禁检查的规则

`pnpm gate` 的静态检查运行 Vite+ 自带的 Oxlint，以下规则违反即失败：

| 规则 | 要求 | Oxlint 规则 |
| --- | --- | --- |
| 文件与目录名 | 小写单词以 `-` 连接，可带数字与 `.test`、`.e2e`、`.bench` 这类角色后缀 | `unicorn/filename-case`（kebabCase） |
| 默认导出 | 不使用默认导出；例外是宿主要求的入口：Concord mod 的 `main.ts`、`bench/*.bench.ts` 与工具配置文件 | `import/no-default-export` |
| 只用作类型的导入 | 写成 `import type` 或内联 `type` | `typescript/consistent-type-imports` |
| 可擦除语法 | 不用 `enum`、`namespace` 与构造函数参数属性 | TypeScript 的 `erasableSyntaxOnly` |
| 相对导入 | 写出真实扩展名 `.ts` 或 `.tsx` | 类型检查与[从源码运行](../build/architecture.md#从源码运行) |

模块出口、分层方向与平台能力由[架构守护](../testing/architecture.md#架构守护)检查。

## 命名

| 对象 | 写法 | 示例 |
| --- | --- | --- |
| 类型、接口、类、React 组件 | PascalCase，接口不加 `I` 前缀 | `GitService`、`SearchDialog` |
| Schema 与它推导的类型 | 同一个 PascalCase 名字：`export const Plan = Schema.Struct(…)` 与 `export type Plan = typeof Plan.Type` | `Plan` |
| Effect 服务 | `class Git extends Context.Service<Git, …>()('concord/<层>/<模块>/Git')`，key 的末段与类名相同 | `concord/base/git/Git` |
| Layer | 服务类上的 `static readonly layer`；独立的 Layer 值用 `<名字>Layer`，不用 `Live` 后缀 | `Git.layer`、`queriesLayer` |
| `Effect.fn` | 必须给名字，格式为 `<服务或模块>.<操作>` | `Effect.fn('Git.run')` |
| 函数与变量 | lowerCamelCase；谓词以 `is`、`has`、`can` 开头 | `decodeFeedbackDocument`、`hasConfirmedOwnedGroupCleanup` |
| 常量 | lowerCamelCase；协议常量与固定上限用 UPPER_SNAKE_CASE | `OUTPUT_LIMIT` |
| 具名错误 | PascalCase，写出失败的情形，不强制 `Error` 后缀；对外暴露时类名就是错误码 | `HerdrModPathOccupied` |
| 测试文件 | `<主题>.test.ts`、`<主题>.e2e.ts`；超出耗时上限拆分时依次加 `-2`、`-3` | `editor-lsp-2.test.ts` |

Schema 与类型同名，是因为同一个领域概念只需要一个名字（[一个词一个意思](../../taste.md#t-2)）；`Schema` 后缀与同名写法在代码中各占一半，按这条统一。

## 模块与文件

- `src/` 中每个目录是一个模块，`index.ts` 只做出口：转出本模块的接口，不写实现。
- 一个文件按主题组织，可以放一组相关的 Schema、错误、服务与函数；不按“一个文件一个声明”拆分。
- `web/` 的组件、hooks 与 `lib`，`test/` 的 `support` 与 `fixtures` 可以直接按文件导入。

## 错误与失败

- `src/` 中的失败使用具名错误：新错误用 `Schema.TaggedError`，能经 RPC 与 `--json` 原样传递。领域与应用不直接抛出 `new Error(…)`，它只用于表达不可能到达的分支。
- 在 Effect 中用 `Effect.fail` 返回具名错误，在平台边界用 `Effect.try`、`Effect.tryPromise` 与 `Effect.mapError` 转换外部失败。
- 不可信输入在边界用严格 Schema 解码（AGENTS.md）。

## 注释

- 说明性注释用英文，写代码为什么这样做，不复述代码做了什么。
- Concord 标记（`@concord-file`、`@concord-implements`、`@concord-code`、`@concord-begin` 与 `@concord-end`）按[代码归属声明](../../architecture.md#代码归属声明)书写。

## 审阅时检查

门禁检查不到的规则（命名、`index.ts` 只做出口、具名错误）在审阅时对照本页，见 `/concord-review`。不符合本页的存量代码在修改到它时一并改正。
