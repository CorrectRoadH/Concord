# Cases

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | 快照期间仓库根的祖先被替换为 symlink | 快照中读取若干文件后，把仓库根的父目录改名并在原位置放置指向另一目录的 symlink | 下一次读取在读字节前以 `UnsafePath` 失败 |
| C1b | 快照期间祖先被替换为另一真实目录 | 把仓库根的父目录改名，再在原位置新建同名真实目录并放入仓库副本 | 下一次读取以 `UnsafePath` 失败 |
| C2 | 快照期间仓库内目录被替换为 symlink | 快照中读取 `src/a.ts` 后，把 `src` 换成指向仓库外的 symlink | 下一次读取 `src/b.ts` 在读字节前以 `UnsafePath` 失败 |
| C2b | 叶子在检查与打开之间被替换为 symlink | 组件检查通过后、打开前把目标文件换成 symlink | 打开失败（`ELOOP`），报 `UnsafePath` |
| C3 | 快照期间仓库内条目按大小写改名（Darwin） | 读取 `docs/Feature.md` 后把它改名为 `docs/feature.md` | 当前查询以 `PreimageChanged`（`source-observation`）失败；历史投影把该条目路径列入 changedPaths；规划读取后改名的发布同样以 `PreimageChanged` 拒绝 |
| C3c | 编辑器以 rename 原子保存被读取的文件 | 组件检查后、打开前，用临时文件 rename 覆盖目标 | 当前查询报 `SourceChanged`；这是无结构异常；投影刷新只更新 lastAttempt，changedPaths 为 `['.']`，不列具体路径；不报 `UnsafePath` |
| C4 | 仓库位于很宽的父目录下 | 仓库根的父目录含 5000 个条目；读取 1000 个仓库文件 | 构造之后仓库根之上 `readdirSync` 为 0；拼写检查每目录至多一次，加每次成员扫描的新鲜枚举；逐目录计数由 `test/path-safety-cost.test.ts` 证明；构造阶段次数单独列出 |
| C5 | 写入目标拼写与条目不一致（Darwin） | 写入 `docs/Feature.md`，磁盘上为 `docs/feature.md` | 与现状相同，以 `UnsafePath` 拒绝 |
| C7 | Darwin 上发布新建目录 | 快照内 preflight 读过 `docs` 后，发布 `docs/new/x.md` | 发布成功 |
| C8 | 查询期间出现无关新文件 | 查询读过 `docs` 中若干文件（未以 `files()` 扫描 `docs`）后，在 `docs` 新建一个未被读取的文件 | 当前查询成功；历史投影不因此标为不一致 |
| C9 | 快照中被扫描目录新增成员 | 扫描 `test` 后在 `test` 新建测试文件 | 当前查询以 `PreimageChanged` 失败 |
| C10 | 写者提交后的核验 | optimistic 写者完成发布 | 不出现 `PreimageChanged` |
| C6 | 大仓库刷新扫描超时 | `scale` 默认规模，`pnpm bench query --consumer scale` | 刷新扫描最大值不超过刷新上限 |
