# 使用统一的可重建持久缓存

## 用户目标

维护者想让连续运行的命令更快，并在需要时查看、删除或重建缓存，同时确信缓存的任何状态都不会改变命令结论。

## 起始状态

- 项目已初始化，安装的是打包后的 Concord。
- 注解、代码、配置和远端反馈快照共用 Git-private 目录中的同一个 `cache.hawdb`，彼此以命名空间隔离。
- 缓存目录可写。只读命令也可能需要写入：工作区服务可以保存查询产生的可重建缓存行，读取也可能重建缓存内部的派生文件或创建 Concord 准入锁。

## 完整路径

1. 连续运行检查。 {#hit}

   ```sh
   concord check
   concord check
   ```

   第二次输出 `Cache: hit`。扫描分别报告测试缓存与代码缓存的状态、命中数和未命中数；缓存操作失败时停止本次操作并报告具名原因，不转为来源扫描成功（[失败就报错](../../../taste.md#t-17)）。一个文件解析失败不影响其它文件的结果。

2. 编辑、新增或删除一个来源文件，再运行命令。 {#invalidate}

   对应的缓存键立即失效，命令重新读取这个文件；没有变化的文件继续命中。

3. 查看缓存状态。 {#status}

   ```sh
   concord cache status
   ```

   ```text
   sourceDigest: sha256:ca7a7bcd…
   status: ready
   path: /tmp/demo/.git/concord/cache.hawdb
   detail: projections: annotation_cache, query_cache, workspace_projection
   physicalBytes: 7418888
   ```

   `ready` 表示投影可读，不表示某次扫描命中。全部字段见 [CLI](../cli.md#缓存状态)。

   结果还说明缓存由谁持有。`owner` 为 `service` 时由工作区服务持有，`pid` 与 `installation` 是服务的进程号与安装身份（与 `concord server status` 的 `installation` 相同），`sourceDigest` 是服务当前结果的摘要；没有服务时 `owner` 为 `process`，`pid` 与 `installation` 是当前 CLI 进程的。人读输出多出三行，例如：

   ```text
   owner: service
   pid: 48211
   installation: sha256:7baa718a…
   ```

   `--json` 在顶层给出同名字段 `owner`、`pid`（整数）与 `installation`（字符串）。状态检查同时验证安装目录的原生产物，缓存目录缺失不掩盖安装故障。

4. 预览清理。 {#preview}

   ```sh
   concord cache clear --dry-run
   ```

   ```text
   cache clear
   dryRun: true
   engine: hawdb
   path: /tmp/demo/.git/concord/cache.hawdb
   existing: true
   remove:
     /tmp/demo/.git/concord/cache.hawdb/adjacency.1.hawdb
     …
   preserve:
     /tmp/demo/.git/concord/cache.hawdb
     /tmp/demo/.git/concord/cache.hawdb/owner.hawdb.lock
     /tmp/demo/.git/concord/cache.hawdb/branches/metadata.hawdb.lock
     …
     /tmp/demo/.git/concord/cache.hawdb.concord.lock
   native:
     status: ready
   ownership: checked-on-execution
   ```

   预览列出引擎、缓存路径、是否存在、待删除的顶层条目、保留路径和原生产物可用性。预览不取得清理锁，也不创建缓存；预览成功不授权删除。

5. 清理缓存。 {#clear}

   ```sh
   concord cache clear
   ```

   ```text
   status: cleared
   path: /tmp/demo/.git/concord/cache.hawdb
   ```

   clear 只删除 `cache.hawdb` 内的缓存数据，执行时取得全部引擎锁并重新检查路径与所有权。缓存目录、全部引擎锁及承载它们的目录、同级 `cache.hawdb.concord.lock` 的 inode 保留。工作区服务运行时，clear 经由服务执行。

6. 再次运行命令。 {#rebuild}

   命令冷启动并重建缓存，也可以运行 `concord cache rebuild` 显式重建。重建后来源内容与证据摘要不变。远端反馈的观察只能由显式刷新重新获得，本地已捕获的 Issue 保留。

## 结果

缓存只加速。正常命中与未命中的结果一致。依赖故障时操作失败，不产生替代的成功结果。

| 情形 | 看到什么 |
| --- | --- |
| 缓存键缺失或来源摘要变化 | 正常读取来源并计算当前键 |
| 数据库损坏或命中行不合 Schema | 具名报错，保留现场，不把故障当成未命中 |
| 数据库被其他进程占用 | 操作以 `HawdbBusy` 失败，不切换内存库 |
| 读取远端反馈快照或诊断投影 | 工作区服务运行时经由服务读取；没有服务而库被占用时报告不可用，不当作空集合 |
| 远端快照读取失败 | 不触发网络请求，不覆盖已捕获的本地 Issue |
| 一次完整的远端 fetch 写入缓存 | 合并是原子的，时间戳单调，同版本内容冲突受保护 |
| 确认缓存记录属于另一 schema 版本 | 持久 owner 按[自动失效处理](../architecture.md#cache-schema-invalidation)受锁清理并重建一次；本地 Issue 保留，远端观察需要显式刷新 |
| `--dry-run` 或关闭缓存 | 不访问持久数据库；`feedback` 使用本地 Issue 已捕获的来源信息，不发远端请求 |
| `cache status --dry-run` | 只检查路径和原生产物：缓存缺失或只含引擎锁时为 `empty`，其它情况为 `unavailable` 并说明持久访问关闭，不声称 `ready` |
| 原生产物摘要错误 | 扫描与状态查询给出相同的诊断：产物路径、预期与实际摘要，以及修复安装的提示；clear 不能修复安装 |
| 原生产物加载失败后修好安装 | 期间依赖该产物的操作失败；下一次尝试重新验证同一依赖，成功后恢复 |
| clear 遇到 symlink、越界路径、外部硬链接或活动句柄 | 拒绝删除；完整计数的内部硬链接允许清理 |
| 缓存目录不存在时 clear | 无操作；只有完整预检后只含引擎锁的目录报告 `empty`，未知内容不归为空 |
| clear 中断或部分失败 | 保留现场并具名报告，服务进入 blocked；重启服务后再次 clear 继续完成 |
| 缓存目录很大 | 目录总容量与文件数量不限制打开、状态检查和清理，校验不因目录大而跳过 |
| 缓存物理体积增长 | 不自动回收或丢弃；`physicalBytes` 如实报告，需要时由使用者运行 `concord cache clear` |
| 数据库有不完整尾部或损坏 | 服务的可写打开只修复物理不完整尾部；其它损坏保留现场并具名报错，由使用者显式 clear |

体积、批处理与恢复的机制见[架构](../architecture.md#缓存的使用与维护)。

### 验收方式

验收使用打包后安装到隔离 Git 仓库的 CLI，执行检查、代码扫描、反馈列表与 `cache status`、`cache rebuild`、`cache clear`，覆盖以下情形：

- 冷热命中、损坏、陈旧 payload、源码变化后的旧键、解析结果为 undefined、短期缓存达到容量、同进程多个命名空间，以及 CLI 与 Web 交替读取。
- 重复进程、事务回滚、提交前 SIGKILL 后重开、已提交 WAL 恢复，以及没有工作区服务时快照结束后的句柄释放；远端旧版本与同版本冲突。
- 真实旧缓存的升级接入、逻辑只读，以及已有完整缓存上的 dry-run 与关闭缓存；验收使用独立新进程，避免进程内配置命中掩盖持久访问。
- 工作区服务运行时，4 个只读命令与 1 个写命令并发，全部成功且不以 `HawdbBusy` 失败；服务运行时 `feedback list` 的远端快照与只运行 CLI 时相同。
- 三个启动者同时启动只得到一个服务；服务在请求中被 `SIGKILL` 后下一次调用正常；临时仓库使用 `--server=command` 查询时，命令结束前回收后台进程。
- 服务退出或机器重启后，残留运行记录即使损坏或设备身份失效，下一次查询也能启动服务；`server stop` 成功确认已经停止。仍有持有者或无法验证服务锁时保留现场并报告错误。
- 同进程双向与跨进程的句柄互斥，clear 与直接调用 HawDB 的分支句柄双向阻止并报告 busy 类别；close 到取得清理锁之间被外部抢占、清理中替换根或锁、重开争用；损坏库的受锁清理、空库重开、全部引擎锁与同级锁 inode 保留。
- 缓存目录外的其它文件、目录或内部文件为 symlink、跨目录内部链接与外部链接、内部锁别名、预检后链接或身份变化、新增成员，以及中断清理后的重试。
- 清空后离线读取本地 Issue；无 SQLite 运行时导入。
- 在没有 Rust 与系统 Node.js 的环境中离线解压发版归档后实际操作，覆盖 Linux 与 macOS 原生产物及产物缺失或身份不匹配。
