# 测试注释与命令证据

Concord 从受支持的 JS/TS 静态测试声明旁读取唯一正向关系。先让目标 Feature 或 Use Case 存在，再生成注释：

```sh
concord test annotate --contract docs/feature/login/use-case/expired-token.md --regression memory/expired-token-accepted.md
```

把输出紧邻放在真实 `test` / `it` 声明正上方；可重复 `--regression`。示意：

```ts
// @use-case docs/feature/login/use-case/expired-token.md
// @regression memory/expired-token-accepted.md
test('rejects expired tokens', () => {})
```

指向整个 Feature 时改用 `// @feature docs/feature/login/README.md`，每个测试只选择一个契约目标。

不要另建测试关系 JSON。Git 保存测试演进；动态、悬空、重复或歧义声明会形成 finding。退役关系使用 `// @status retired`。先检查并发现 case：

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
