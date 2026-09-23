# 测试注释与命令证据

Concord 从测试根里的 Concord 标记读取唯一正向关系，不解析宿主测试语法。标记存在即表示该测试关联存在。先让目标 Feature 或 Use Case 存在，再生成注释：

```sh
concord test annotate --contract docs/feature/login/use-case/expired-token.md --regression memory/expired-token-accepted.md
```

把输出放进测试文件；`//`、`#` 和 `--` 都是标记。可重复 `--regression`。没有 `@name` 时运行覆盖整个文件，不声称选中了某个原生用例。示意：

```ts
// @use-case docs/feature/login/use-case/expired-token.md
// @regression memory/expired-token-accepted.md
test('rejects expired tokens', () => {})
```

指向整个 Feature 时改用 `// @feature docs/feature/login/README.md`，每个测试只选择一个契约目标。

不要另建测试关系 JSON。Git 保存测试演进。缺值、一块标记上的重复契约、以及只有 `@regression` / `@status` / `@name` 的块会形成 finding；不认识的测试写法不是 finding。退役关系使用 `// @status retired`。Repository profile 的注释解析是另一套规则，不由本页的 CLI 扫描代替。先检查并发现 case：

```sh
concord check --json
concord test list --json
concord test show <derived-reference> --json
```

只有 `test run` 会执行项目 runner：

```sh
concord test run <derived-reference> --json
concord test evidence ccev_REPLACE_WITH_ID --json
```

收据的 evidence scope 是整个作者声明 command，不是底层 runner 的逐 case 原生覆盖证明。超时、信号、启动失败、已知零执行、全 skip/todo 或输出限制不能作为 fixed 的正常 green；通用 runner 的 unknown execution 也不能表述为 native case passed。

修复 Problem 时先取得正常非零退出的 red，保持测试定义与契约不变，只修产品实现，再取得成功且清理完成的 green。候选、完整测试文件、runner 配置、声明的 sourceFiles 或契约变化都会使证据陈旧。不要手写或导入收据。
