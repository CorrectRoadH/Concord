# 自举架构

全局 link 只提供稳定的公开 CLI 入口，其 realpath 指向当前 checkout 的 `dist/entry.js`。文档 mutation 必须通过该 CLI 创建 owner 或使用 digest-aware page/author 命令更新；不手写 frontmatter。

测试关系由 `test/*.test.ts` 中的注释拥有。自举 smoke 先只读解析当前项目格式、runner argv、sourceFiles 与构建版本，再把当前测试源码、Feature owner 和声明的 sourceFiles 复制到隔离 Git 消费者；扫描该副本并运行当前构建产物的 `check` 与 `trace check`，严格解码 JSON。缓存或检查副作用只发生在临时消费者，不修改当前仓库、不创建当前仓库证据，也不递归启动完整检查。

Git-private cache/evidence/journal 不提交。删除 cache 后仍可从 Markdown 与源码恢复关系；因此自举验收必须同时覆盖冷/热扫描边界和当前 owner 完整性。
