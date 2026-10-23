# 分支项目引擎接入

## 版本与边界

HawDB 固定为 v0.13.0，revision 为 `91aec4960ed27516962cf1dc918307f57faef15d`。桥接 ABI 保持 `concord-hawdb-1`，缓存表 schema 保持 1。命名空间、逻辑预算及 TypeScript API 保持原有语义。

引擎默认 features 关闭，不启用后台维护、向量或全文检索。Rust 与 N-API 版本精确固定。事务获取失败保留具名错误，分支争用不能包装成 schema 不兼容。

本方案适用 [C-001](../../../../constitution.md#c-001)、[C-003](../../../../constitution.md#c-003)、[C-004](../../../../constitution.md#c-004)、[C-005](../../../../constitution.md#c-005)、[C-007](../../../../constitution.md#c-007)、[C-009](../../../../constitution.md#c-009)、[C-013](../../../../constitution.md#c-013)、[C-014](../../../../constitution.md#c-014) 和 [C-015](../../../../constitution.md#c-015)。变更限于派生缓存访问和固定版本的所有权适配，不改变来源归属或文档发布授权。

## 完整句柄所有权

数据库路径为 `cache.hawdb` 时，Concord 使用同级的 `cache.hawdb.concord.lock` 协调完整句柄生命周期。锁路径由已验证的数据库路径派生，位于同一个真实父目录，clear 不删除它。

协调锁必须是单链接普通文件。打开使用 `O_NOFOLLOW`，不截断文件；通过非阻塞 `File::try_lock` 竞争。路径与已打开描述符必须指向相同 device/inode。数据库根目录身份也必须保存并复核。占用、权限、I/O 和异常路径分别具名失败。

持久句柄在检查引擎目录和调用引擎前取得协调锁，持续持有至 schema 准入、事务、checkpoint、引擎销毁及关闭后目录检查全部结束。关闭失败也释放锁。内存实例没有文件锁。最外层来源快照继续先关闭数据库，再取得文档 publication lease。

existing-only 打开缺失数据库时，不创建任何锁或目录。可写创建允许建立已验证的数据库目录和协调锁。只读打开已有库时可以创建协调锁，但不初始化缺失的根 manifest、根 ownership 锁或表。

已有 `branch.head` 的目录必须已有结构性 `owner.hawdb.lock`，只读不能补建它。分支的 `runtime/` 及其锁属于可重建派生文件，可以随挂载重建。根目录与协调锁被替换时拒绝操作。协调锁不是第二个缓存或来源 owner。

## 清理与原生引擎互斥

clear 先关闭本仓库的持久句柄，再取得相同协调锁。随后锁住根 `owner.hawdb.lock`，并按路径排序锁住树内全部以 `.lock` 结尾的普通文件，包括分支和 catalog 锁。任一占用、路径异常或未知锁错误均拒绝删除。

全部锁描述符持续持有到清理结束。只有显式 clear 可以为已验证目录补建根锁，不补建缺失的嵌套引擎锁。取得锁后重新检查完整目录、锁集合和 inode，再由 TypeScript 在守卫下生成新的删除清单。

删除分为三个阶段：先删除全部非锁文件，再删除嵌套锁文件，最后删除空的嵌套目录。每次删除前复核根目录与协调锁、根锁的身份；阶段边界复核剩余集合。根目录、根锁和协调锁的 inode 保留。

任何嵌套锁路径消失前，selector、catalog 和 branch head 必须已删除。固定引擎在取得 branch lease 后才读取 `branch.head`。因此，延迟准入即使重新创建锁，也会因 head 缺失而拒绝挂载 runtime。已关闭守卫不能授权后续删除。

协调锁覆盖采用 0.13.0 的 Concord 的 metadata-only 与延迟准入阶段。原生引擎锁阻止清理已持有根或分支的直接调用 HawDB 的句柄。不保证直接调用 HawDB 的程序并发创建新分支或恶意路径替换。升级和降级期间不得混用新旧 Concord 进程；已有旧引擎句柄由根锁检测。

## 内部硬链接

checkpoint 和恢复选择器允许目录内部硬链接。原生检查与 TypeScript 预检均不跟随 symlink，按精确 device/inode 汇总普通文件。每组观察到的 link count 必须一致，且等于根内不同路径数。外部别名、计数变化、symlink 和特殊文件均拒绝。

所有 `.lock` 文件仍要求单链接。删除预检记录文件身份、目录身份与成员集合，以及每组剩余链接数。unlink 前要求路径身份不变且当前 link count 等于剩余数；成功后递减。新增项、替换项和外部硬链接不得被当作原删除清单处理。

部分删除返回具名失败并保留现场。后续显式 clear 可以重新取得守卫和清单后继续。不因打开失败而自动修复或删除。

## 读取与恢复

只读表示不写来源、不修改逻辑缓存行。已有完整缓存允许分支 runtime 挂载、内部派生文件重建，以及同级协调锁。因此，缓存读取可能需要可写的临时存储。只读不允许初始化表、修改行、显式 checkpoint、修复 WAL 或远端刷新。

验收检查逻辑行与来源、evidence、journal 字节不变，不要求所有引擎文件身份不变。缺失或损坏缓存仍回源或报告具名不可用。

dry-run 和 cache-off 均不打开持久 HawDB。该规则覆盖配置加载、诊断、feedback、status 和变更预览。dry-run status 可以检查路径和原生产物；缺失或 owner-only 时返回 `empty`，其它情况返回 `unavailable` 并说明持久缓存访问关闭。不读取就不能声称 `ready`。

clear 预览只列清单，不取原生锁、不创建文件。普通 status 可以在完整句柄锁内重建派生文件。

Repository 暴露可选只读属性 `persistentCache: 'use' | 'off'`。LocalRepository 接受相同构造选项，独立于来源访问权限；dry-run 强制其有效值为 `off`。中央 `withPersistentCache` 对关闭的读取提供 absent database，对误入的写入返回 `HawdbUnavailable`。

`cacheStatus` 在打开数据库前检查该设置。构造配置解析关闭持久访问时不传缓存目录，进程内解析缓存仍可使用。聚合 `checkCurrentProject` 和工作区 `compileWorkspace` 在构造 Repository 前传入操作的缓存模式。

LocalRepository 内所有直接配置 `snapshot` 调用，包括配置变更规划，均尊重仓库设置及单次变更的 dry-run。query-scan worker 的 dry-run 仓库使用相同边界。验收使用已有完整缓存和独立新进程，避免进程内配置命中掩盖绕行访问。

严格恢复保持启用。有效已提交 WAL 可由公开只读 API 读取，不授权逻辑写入。若固定版本明确要求可写恢复，仅已启用缓存的工作区扫描可用 existing-only writer checkpoint 后重试。损坏或不支持的现场保留；不启用 repair mode。

桥接识别 typed `HawDBError::BranchBusy` 及固定版本的旧目录锁争用。该分类贯穿 schema 与事务准入。真正的 schema 形状错误仍为 `HawdbIncompatible`。

## 升级与降级

公开可写打开在 Concord 协调锁内将有效 v0.3 缓存接入分支项目格式。既有表与远端观察必须保留；来源 owner、evidence 和 journal 不迁移。不增加兼容解析器、旧运行时或自动破坏性回退。损坏库仍可通过独立所有权守卫显式清理。

旧桥接拒绝新版内部硬链接。降级前必须停止缓存使用者，使用新版 CLI 显式 clear，再运行旧版。同级协调锁可以保留。清理后远端观察需要显式刷新；本地 Issue 仍由来源拥有。发行说明必须列明读取的派生文件行为、混用限制与降级步骤。

## 预算与验收

已有输入、命名空间、WAL、checkpoint 和内存预算保持不变。关系索引读取固定为 16 MiB，hydration 为 64 MiB。checkpoint 仍为 32 个事务或 4 MiB；内存代次重建上限不变。目录安全检查不设任意容量门槛，不增加 payload 缓存。

验收覆盖以下独立边界：

- 真实旧缓存接入、逻辑只读，以及已有缓存上的 dry-run/cache-off。
- 同进程和跨进程完整句柄互斥；clear 与直接调用 HawDB 的分支句柄双向互斥及延迟准入阶段。
- 根和同级锁 inode 保留，缺失、损坏库清理，跨目录内部链接和外部链接拒绝。
- 内部锁别名、预检后链接或身份变化、新增成员，以及中断清理后的重试。
- 事务回滚、提交前 SIGKILL、已提交 WAL 恢复、命名空间预算和快照释放。
- 隔离消费者中的打包 CLI、Linux/macOS native、完整 `pnpm check` 和同机 CLI/query 延迟对照。

发布来自干净且已审阅的提交。同一提交的 CI、打包安装和渠道验收必须通过，不能用本地 Linux 结果替代 macOS 验收。
