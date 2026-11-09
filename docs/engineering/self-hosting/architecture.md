# 自举实现

`bun run concord` 执行当前 worktree 的源码 CLI，不依赖构建、全局安装或 link。文档直接编辑；Issue 与 Memory 的 frontmatter 按[文档模型](../../document-model.md)书写，由 `check` 校验。

测试关系由 `test/*.test.ts` 中的注释拥有。自举 smoke 先只读解析当前项目格式、runner argv 与构建版本，再按配置复制全部 sourceRoots、testRoots、Memory 来源与 docs 到隔离 Git 消费者。扫描该副本并运行源码 CLI 的 `check` 与 `trace check`。输出 JSON 严格解码。缓存或检查副作用只发生在临时消费者，不修改当前仓库、不创建当前仓库证据，也不递归启动完整检查。

静态检查阶段通过源码 CLI 的 `--json --dry-run check` 检查当前 worktree，保留 CLI 的退出码。这一步不发布 owner 或证据，不打开持久缓存；来源协调可创建 Git-private 目录。它与隔离 smoke 一同进入完整门禁。

隔离 smoke 必须观察到 `repository/engine.ts` 的实现声明，并验证副本中失效的 repository Spec 引用使公开 CLI 检查失败。临时消费者结束后删除；复制来源集合由项目配置派生。

Git-private cache/evidence/journal 不提交。删除 cache 后仍可从 Markdown 与源码恢复关系；因此自举验收必须同时覆盖冷/热扫描边界和当前 owner 完整性。
