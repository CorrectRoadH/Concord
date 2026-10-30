# CLI 热路径与 HawDB 进程模型

## L1: 缓存成功结果与同源重建一致

当前事实查询的成功结果，其领域事实与有效性判断必须与关闭缓存、同源重建一致，不返回陈旧或未经校验的成功结果（[C-014-4](../../constitution.md#c-014-4)）。通过条件：Cases 中每个变更场景在缓存开启与明确禁止持久缓存访问时输出相同的事实与 findings。

## L2: 不跳过安全与完整性检查

不得为性能跳过摘要或 Schema 校验、路径安全、完整性门禁、授权检查，或缩减全局诊断范围（[C-014-3](../../constitution.md#c-014-3)）。每次命令照常读取来源原文并核对摘要。

## L3: HawDB 只保存可重建缓存

HawDB 只保存可重建投影与可丢弃缓存（[C-001-4](../../constitution.md#c-001-4)）。删除缓存不改变任何结果；清理协议保留锁 inode 的规则不变（[统一缓存](../../feature/local-data-engine/use-case/use-unified-cache.md)）。

## L4: 写入、发布与证据核对原文字节

写入前像、CAS、publication、恢复与证据裁决核对原文摘要，不使用缓存或指纹判定（[C-003](../../constitution.md#c-003)、[C-004](../../constitution.md#c-004)）。

## L5: 按引擎规定持有 HawDB

同一 HawDB 目录在任一时刻只由一个进程打开，其它进程不直接打开该目录；所有者持有句柄的时间足以让引擎完成后台维护。来源：固定 revision 的 HawDB README 第 153、157、312 行。通过条件：并发调用中没有进程因目录被占用而失败或重试打开；C7 的体积与打开耗时由引擎维护保持在 G4 范围内。

## L6: 本地、可安装、无部署服务

消费者无需全局程序、系统服务、部署服务或额外数据库服务（[C-002](../../constitution.md#c-002-1)）。Concord 自行按需启动并在空闲时退出的用户进程允许；它不可用时命令仍须得到正确结果。

## L7: 固定依赖不变

HawDB revision、napi/napi-derive、Rust 工具链及其锁文件保持固定版本（AGENTS.md）。在固定 revision 内启用其已有的 Cargo feature 不属于升级，但须重新验证原生产物身份、体积与发行流程。

## L8: 公开输出不变

`--json` 结构、具名错误码与退出码不变（[C-015](../../constitution.md#c-015)）。新增诊断字段不改变既有字段语义。

## L9: 严格 TypeScript 与 Effect

维护代码采用严格 TypeScript 与 Effect，原生例外仅限 `native/hawdb` 的既定职责（[C-005](../../constitution.md#c-005)）。
