# 项目配置文件

`concord.config.ts` 是 Concord 唯一的项目配置文件，位于项目目录根部。它可以不存在，此时全部配置项取默认值。怎样决定写不写、写哪几项，见[安全维护项目配置](use-case/maintain-project-config.md)。

## 语法

文件只有一个 `export default` 字面对象，可以带类型导入、`as const` 与 `satisfies`。运行时只读取这个文件并静态求值，不执行模块，也不读取或检测其它文件（[当前格式](../../architecture.md#当前格式)）。

```ts
export default {
  testRoots: ['spec'],
};
```

配置是静态数据。编辑器补全与校验所用的 JSON Schema 由 `concord schema config` 输出，见[机器可读 Schema](../local-sdlc/cli.md#机器可读-schema)。

## 配置项

| 项 | 默认 | 何时配置 |
| --- | --- | --- |
| `testRoots` | 存在的 `test/`、`tests/` | 测试在其它位置 |
| `sourceRoots` | 存在的 `src/` | 实现在其它位置 |
| `sourceIgnore` | 无；另外始终排除 `.env`、`.env.*` 与 `dist` | vendor、生成文件 |
| `testAdapters`、`languageServers`、`feedbackConnections`、`p5`、`docsWork` | 无 | 按需；`docsWork` 见 [Docs Work 配置](../neutral-project-governance/cli.md#docs-work-配置) |
| `pageKinds` | 无 | 文档包里要放内置种类以外的页面，见[可扩展的页面种类](../extensible-page-kinds/README.md) |

`pageKinds` 的每一项有三个字段，都必需：`name` 是种类名，也是文件名或种类目录名，由小写字母、数字与连字符组成，1 到 64 个字符；`question` 是这一页回答的读者问题，非空，不超过 200 个字符；`category` 是 `behavior` 或 `implementation`，含义与[页面种类](../../document-model.md#页面种类)的类别相同。`name` 不能重复，也不能与内置种类或保留名 `README`、`use-case`、`concepts`、`writing` 相同，否则以 `InvalidData` 拒绝。

`testAdapters` 只配置原生用例收集，读取 label、身份与来源范围，见[收集协议](../local-sdlc/cli.md#原生测试-adapter)。测试执行由 agent 使用项目工具完成；配置不接受 runner 或测试运行选项。

显式的 `testRoots` 或 `sourceRoots` 替换对应默认值，不与默认值合并。发现范围、收集输入与 Web 的源码写入范围分别定义；默认值不扩大 Web 的源码写入范围。`sourceIgnore` 的匹配与显式来源优先级见[发现测试](../local-sdlc/use-case/discover-annotated-tests.md)。

## 校验错误

配置按当前 Schema 严格解码；未列出的字段是无效输入。CLI、init、dry-run、recover 与工作区服务对同一现场给出同一结果：

| 错误 | 触发条件 |
| --- | --- |
| `InvalidConfigSyntax` | 重复键、spread、computed key、调用、其它运行时表达式或额外语句 |
| `InvalidData` | 配置不符合当前 Schema，包括未列出的字段 |

拒绝不改变配置文件内容；陈旧或无法解码的 journal 由工作区服务或恢复命令自动清理并输出警告，不阻断仓库读写。
