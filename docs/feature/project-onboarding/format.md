# 项目配置文件

`concord.config.ts` 是 Concord 唯一的项目配置文件，位于项目目录根部。它可以不存在，此时全部配置项取默认值。怎样决定写不写、写哪几项，见[安全维护项目配置](use-case/maintain-project-config.md)。

## 语法

文件只有一个 `export default` 字面对象，可以带类型导入、`as const` 与 `satisfies`。运行时只读取这个文件并静态求值，不执行模块，也不读取或检测其它文件（[当前格式](../../architecture.md#当前格式)）。

```ts
export default {
  testRoots: ['spec'],
  runner: {
    argv: ['node', '--test', '{file}'],
    timeoutMs: 60000,
  },
};
```

配置是静态数据。编辑器补全与校验所用的 JSON Schema 由 `concord schema config` 输出，见[机器可读 Schema](../local-sdlc/cli.md#机器可读-schema)。

## 配置项

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `runner` | 无 | 需要 `test run` 或修复核验时 |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需；`docsWork` 见 [Docs Work 配置](../neutral-project-governance/cli.md#docs-work-配置) |

`runner` 直接声明不经 shell 执行的 `argv`（其中可使用 `{file}`、`{name}`、`{pattern}` 占位）与可选 `timeoutMs`（1 到 3600000 毫秒的整数，默认 `60000`），不需要 `kind`、`prepare` 或 `sourceFiles` 字段（[一件事只写一次，其余推导](../../taste.md#t-3)）。`test run` 与[修复核验](../local-sdlc/architecture.md#修复核验)执行同一条 `runner` 命令。

显式的 `testRoots` 或 `sourceRoots` 替换对应默认值，不与默认值合并。发现范围、runner 输入与 Web 的源码写入范围分别定义；默认值不扩大 Web 的源码写入范围。`sourceIgnore` 的匹配与显式来源优先级见[发现测试](../local-sdlc/use-case/discover-annotated-tests.md)。

## 校验错误

配置按当前 Schema 严格解码；未列出的字段是无效输入。CLI、init、dry-run、recover 与工作区服务对同一现场给出同一结果：

| 错误 | 触发条件 |
| --- | --- |
| `InvalidConfigSyntax` | 重复键、spread、computed key、调用、其它运行时表达式或额外语句 |
| `InvalidData` | 配置或未完成事务不符合当前 Schema，包括未列出的字段 |

拒绝不改变配置、journal、锁、事务目标与临时文件的内容、存在性或权限；无法解码的 journal 阻断写入。
