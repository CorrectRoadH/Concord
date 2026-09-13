# 自举检查命令

自举 runner 为：

```text
node --import tsx --test --test-name-pattern {pattern} {file}
```

占位符逐 argv 参数替换，不经过 shell。日常只读检查依次使用 `concord doctor`、`concord check`、`concord test list`、`concord trace check`、定向 `concord trace show local-sdlc` 与 `concord review render local-sdlc`。需要真实收据时才使用 `concord test run <case>`。

最终仓库验收由父流程执行 `pnpm check`；自举 smoke 不在 Node test 内递归调用该命令。
