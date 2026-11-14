# 自举检查命令

自举测试由 agent 直接运行 `bun run test <file>`，使用项目固定版本的官方 Bun test；执行命令与完整参数由 `package.json` 和工程文档拥有。Concord 不再包装测试命令。

```sh
bun run test --test-name-pattern='<表达式>' <文件>
bun run concord --json --dry-run check
```

自举检查用源码 CLI 检查当前 worktree。退出 0 表示检查通过，非零表示违规、输入不完整或执行失败；输出由[合并检查](../../feature/documentation-quality/cli.md)拥有。它不递归运行测试。

日常只读检查还可使用 `concord doctor`、`concord test list`、`concord trace check` 与定向 `concord review`。行为验证由 agent 运行相关项目测试并报告实际结果。交付分别调用[检查入口](../testing/README.md#检查入口)列出的工具。
