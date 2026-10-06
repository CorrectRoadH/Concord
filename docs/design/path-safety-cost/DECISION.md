# Decision

## Decision

Selected: [anchored-root](plans/anchored-root/README.md)

## Rationale

祖先目录在打开仓库时完整检查一次，之后用 bigint `dev`/`ino` 与根目录 fd 锚定，快照内读取不再枚举仓库根之上的目录。只读解析与写入解析分成两个入口，写入、建目录与删除、发布、恢复和 init 保持每次完整检查。文件以不跟随 symlink 的方式打开并 `fstat` 核对，比现状更早拒绝叶子竞态。Darwin 拼写只复核实际查过的条目，漂移路径与 diagnostic-projection-drift 的 `changedPaths` 语义一致。

G2: 刷新扫描能否进入上限只能实测确定；实现交付须附 `pnpm bench query --consumer scale` 的记录，未达标时按 C-014.3 继续定位，不放宽检查。

## Rejected Options

每次读取从 `/` 逐级 `readdir` 的现状不满足 C-014.1 与 G2。快照结束时对目录整表字节比对会在无关编辑时误拒当前查询，并让投影退化为范围未知。realpath-compare 在大小写上可行，但 Unicode 规范化未验证，且不能证明祖先目录身份未变，也不收掉叶子竞态。

## Residual Risks

指向仓库外的硬链接、覆盖仓库内目录的挂载，与现状一样不被拒绝。Linux 上中间组件在打开前后被替换的竞态只能靠 `/proc/self/fd` 事后比对缩小。网络文件系统与 overlayfs 的 inode 不稳定会导致误拒。祖先仅大小写改名时 inode 不变，视为同一仓库。快照内大小写改名的错误码由 `UnsafePath` 变为 `PreimageChanged`。Linux 上 `/proc` 不可用时读取被拒绝；编辑器原子保存产生的 inode 变化按来源变化归类。要求 macOS 11 及以上，更低版本以 `UnsupportedHost` 拒绝。
