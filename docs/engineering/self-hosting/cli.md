# 自举检查命令

自举 runner 为：

```text
node scripts/test-built.ts --test-name-pattern {pattern} {file}
```

占位符逐 argv 参数替换，不经过 shell。日常只读检查依次使用 `concord doctor`、`concord check`、`concord test list`、`concord trace check`、定向 `concord trace show local-sdlc` 与 `concord review local-sdlc`。需要真实收据时才使用 `concord test run <case>`。

`pnpm gate` 的静态检查阶段用源码 CLI 检查当前检出，输出 `concord --json --dry-run check` 的结果。退出 0 表示检查通过，非零表示违规、输入不完整或执行失败；输出由[聚合检查](../../feature/documentation-quality/cli.md)拥有。

最终仓库验收由父流程执行 `pnpm gate`；自举检查不在 Node test 内递归调用该命令。
