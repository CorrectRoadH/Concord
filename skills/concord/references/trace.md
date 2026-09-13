# 检查、追踪与审阅

Concord 从契约 owner、测试源码注释和 Memory 动态编译关系，不维护反向 registry。

```sh
concord check --json
concord trace check --json
concord trace show docs/feature/login/README.md --json
concord review render docs/feature/login/README.md
concord review render
```

`check` 与 `trace check` 校验当前 owner、引用、重复和循环，不执行测试。`trace show` 接受 canonical path / anchor，也可按当前 CLI 支持的引用形式定位；它保留 supporting page 的精确 path/anchor，并动态反查测试与 Memory。

`review render` 只生成本地 Markdown 审阅材料，不写 GitHub、不发送消息。交接时报告实际修改、运行过的验证、具名 finding、私有 evidence 是否可用，以及仍需授权的提交、push、发布或部署。

不要把“无 finding”、命令成功收据或审阅材料表述成完整覆盖、native case passed 或 NiceEval formal E2E 可靠性证明。
