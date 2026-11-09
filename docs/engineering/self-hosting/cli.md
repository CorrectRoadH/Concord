# 自举检查命令

自举 runner 直接调用 Bun test，完整参数由 `concord.config.ts` 拥有。文件与标题占位符逐 argv 参数替换，不经过 shell。`prepare` 在修复核验的临时 checkout 中安装冻结依赖并准备原生绑定，不是测试执行框架。

```sh
bun run test --test-name-pattern='<表达式>' <文件>
bun run concord --json --dry-run check
```

自举检查用源码 CLI 检查当前 worktree。退出 0 表示检查通过，非零表示违规、输入不完整或执行失败；输出由[合并检查](../../feature/documentation-quality/cli.md)拥有。它不递归运行测试。

日常只读检查还可使用 `concord doctor`、`concord test list`、`concord trace check` 与定向 `concord review`。需要真实的 Command evidence 时才使用 `concord test run <case>`。交付分别调用[检查入口](../testing/README.md#检查入口)列出的工具。
