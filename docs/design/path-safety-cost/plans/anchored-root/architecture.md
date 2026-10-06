# 以 inode 锚定仓库根

## 两个路径入口

`LocalRepository` 把路径解析分成两个入口：

| 入口 | 调用者 | 检查 |
| --- | --- | --- |
| `absolute(path)` | 写入、`mkdir`、`rm`、`rmdir`、原子替换、journal、发布 preflight 与 apply、恢复、`initialize`、构造期的 `privateDir` 与 journal 检查 | 现有完整 `assertNoSymlink`，不读取任何复用信息，与现状相同 |
| `readablePath(path)` | 仅 `readCurrent` 与 `scanDirectory`，且快照深度大于 0 | 下文的读取检查 |

写入前像通过 `this.read()` → `readCurrent` 取得，走 `readablePath`；随后的写入动作本身走 `absolute`。任何自身写入（`publishUnderLease`、`apply`、恢复）开始前清空本快照的目录列表，之后的读取重新列出。

## 根锚点

构造函数在确定 `this.root` 之后、设置快照深度之前：

1. 对 `this.root` 调用现有完整 `assertNoSymlink`。
2. 从 `/` 到 `this.root` 对每一级 `lstatSync(p, { bigint: true })`，记录 `RootAnchor = { path, dev, ino }[]`；任一级不是目录或是 symlink 时构造失败，错误与现状相同。锚点只在构造时记录一次。

根目录 fd 属于快照而不属于仓库对象：快照深度 0→1 时（含构造期把深度设为 1 的一段）`openSync(this.root, 'r')`，`fstat({ bigint: true })` 与锚点末级比对，深度回到 0 时关闭。快照存续期间根 inode 因此不会被释放复用；仓库对象没有析构入口也不会泄漏 fd。

`discoverRoot`、`privateDir`、journal 的构造期检查保持完整检查，次数单独计入验收。

## 读取检查

`readablePath(path)` 在读取字节前完成：

1. 锚点核对：对 `RootAnchor` 每一级 `lstat({ bigint: true })`，必须是目录、不是 symlink、`dev`/`ino` 与记录相同；根目录另用本快照持有的 fd `fstat` 比对。不 `readdir`。失败抛 `UnsafePath`。
2. 仓库内组件：对仓库根以下的每个组件，按现有顺序先做 Darwin 拼写核对（下节），再 `lstat` 拒绝 symlink。

`readCurrent` 随后打开文件而不跟随 symlink：

- Darwin：`O_RDONLY | 0x20000000`（`O_NOFOLLOW_ANY`；Node 未导出该常量，要求 macOS 11 及以上，低于该版本时构造以 `UnsupportedHost` 失败）。
- Linux：`O_RDONLY | O_NOFOLLOW`，打开后以 `readlinkSync('/proc/self/fd/<fd>')` 与期望绝对路径比对；`/proc/self/fd` 不可用时拒绝读取（`UnsafePath`），返回值带 ` (deleted)` 后缀视为变化。

打开失败为 `ELOOP` 时报 `UnsafePath`。打开后 `fstat` 的 `isFile` 必须为真，否则报 `InvalidFile`（与现状相同）。`size` 或 `dev`/`ino` 与组件检查最后一次 `lstat` 不一致时，视为读取期间的正常替换（例如编辑器以 rename 原子保存），当前查询报 `SourceChanged`。在 `observeProjection` 内它同样是异常而非 finding：本次扫描以 `ok: false` 结束，按 diagnostic-projection-drift 归为可重试漂移，不返回部分值。随后从 fd 读取。这同时收掉现状在 `lstat` 与 `readFileSync` 之间的叶子竞态。

## 快照内目录列表

`beginSnapshot` 在深度 0→1 时创建两个结构，`endSnapshot` 在深度回到 0 时丢弃；构造函数在设置深度为 1 时同样创建：

- `listings: Map<string, Buffer[]>`：Darwin 拼写核对先查此表，未命中才 `readdirSync(dir, { encoding: 'buffer' })` 并存入。每次 `files()` 的成员扫描都以 buffer 编码新鲜枚举目录，不复用拼写列表作为成员集合。扫描结果写入 `listings`，供子条目拼写核对使用。
- `checkedSegments: Set<string>`：记录每次拼写核对实际查过的仓库相对路径 `dir/segment`。

列表不跨快照、不跨进程、不按时间失效；嵌套快照与 `observeProjection` 共享外层结构。

## 快照结束核验

核验在三处执行，顺序与归类相同：`verifySnapshot`、`observeProjection` 的漂移收集，以及 `publishJournal` 在发布前调用的 `validateObservations`。

核验开始时新建只供本次核验使用的拼写列表 `verifyListings`；读取期的 `listings` 不参与核验。拼写检查每目录至多枚举一次，每次目录成员扫描仍新鲜枚举。步骤：

1. 重新核对 `RootAnchor` 与根 fd。
2. 复核 `checkedSegments`：按目录分组，用 `verifyListings` 检查每段的字节拼写仍存在，且不存在 `darwinPathCollisionKey` 相同的别名。只核对查过的条目，目录中无关条目的增删不影响结果。
3. 现有的文件内容与目录观察比对。其中的 `readCurrent` 与 `scanDirectory` 在核验模式下以 `verifyListings` 作为拼写依据。目录观察比对仍新鲜枚举成员，并更新核验拼写列表。

核验模式下，拼写不一致、别名、锚点 inode 不一致、`fstat` 与 `lstat` 不一致都归为来源变化。当前查询与发布抛 `PreimageChanged`（details 为 `source-observation`）；`observeProjection` 把对应仓库相对路径并入 drift，条目为 `dir/segment`，根级条目为条目名本身，锚点变化为 `.`。只有 symlink、`ELOOP` 与非普通文件报 `UnsafePath`。

发布顺序为“先核验，后清空”：`publishJournal` 的 `validateObservations` 完成全部三步后，才在写入开始前清空 `listings` 与 `checkedSegments`。因此规划读取后被大小写改名的输入在发布前即被拒绝，写者提交后的 `verifySnapshot` 也不会被自己的写入判为变化。

## 对外可见变化

快照内同一条目先以一种拼写读取、随后被大小写改名再读取：现状在第二次读取时报 `UnsafePath`，本方案在快照结束时报 `PreimageChanged`（当前查询）或标为漂移（历史投影）。其它错误码与退出码不变。该变化已在[异步查询契约](../../../../feature/local-data-engine/use-case/query-asynchronous-projections.md)声明；本地 SDLC 的 CLI 页声明属于实现交付项。

## 验收

`src` 级测试在真实临时目录中构造，Darwin 专属用例在运行时检测卷是否大小写敏感，敏感时跳过并说明：

- C1：快照中祖先被换成 symlink → 下一次读取 `UnsafePath`。C1b：祖先被换成 inode 不同的真实目录 → `UnsafePath`。
- C2：仓库内目录被换成 symlink → 下一次读取 `UnsafePath`。C2b：叶子在组件检查与打开之间被换成 symlink → 打开失败（`ELOOP`）报 `UnsafePath`。
- C3：快照内大小写改名 → 快照结束 `PreimageChanged`；投影中该条目路径进入 `changedPaths`。C3b：规划读取后改名，发布以 `PreimageChanged` 拒绝。C3c：编辑器以 rename 原子保存被读取的文件 → 当前查询 `SourceChanged`，这是无结构异常；投影刷新只更新 lastAttempt，changedPaths 为 `['.']`，不列具体路径，不报 `UnsafePath`。
- C5：写入拼写不一致 → `UnsafePath`，与现状相同。
- C7：Darwin 上发布新建目录并写入其中 → 成功。
- C8：查询期间在只被读取（未被 `files()` 扫描）的目录里新建无关文件 → 当前查询成功；投影不因此降为不一致。被 `files()` 扫描过的目录按 C9 处理。
- C9：快照中被扫描目录新增成员 → 当前查询 `PreimageChanged`（现有目录观察仍生效）。
- C10：optimistic 写者提交后 → 不出现 `PreimageChanged`。
- C4：`pnpm bench:profile` 的 fs 计数只按“仓库根之上 / 仓库内 / 其它”汇总，可证明构造后根之上 `readdirSync` 为 0。拼写检查每目录至多一次，加每次成员扫描的新鲜枚举，由 `test/path-safety-cost.test.ts` 的逐目录计数测试证明。构造阶段次数单独列出。
- C6：`pnpm bench query --consumer scale`（默认规模）的刷新扫描最大值不超过刷新上限。
- 现有路径安全测试全部保持通过。
