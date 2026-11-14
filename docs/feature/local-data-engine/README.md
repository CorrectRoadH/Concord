# 统一的本地缓存与检索引擎

每次运行 `concord check`、`trace gaps` 或检索 Memory，Concord 都要读取项目里的文档、测试和代码。本 Feature 把读取和解析的结果存进一份可以随时删除的本地[缓存](concepts.md#cache)，让连续的命令更快。

Spec、Memory、Issue 和证据仍是仓库里的普通文件，删除缓存不会删除它们，也不改变任何检查结论或 fixed 判定。缓存引擎随 Concord [归档](../../concepts.md#archive)发版，不需要另装数据库或服务。

## 你可以做什么

- 连续运行检查和检索，第二次起复用缓存；改过的文件每次都重新核验。
- 在不断增长的 Memory 与 Issue 中重复搜索，复用未变化的正文，返回全部当前命中；首次构建与缓存降级的边界见[检索路径](use-case/query-current-projections.md)。
- 用 `concord cache status` 查看缓存是否可用、占多少空间；用 `concord cache clear` 删除缓存，下一次命令自动重建，结果不变。
- 用 `trace gaps`、`trace show` 和 `review` 立即读取后台最近算好的诊断结果；需要当前结果时加 `--fresh`。
- 在项目的任意子目录运行命令：Concord 自动启动或复用该项目的[工作区服务](../../concepts.md#workspace-server)，多个命令共享热的解析结果。
- 在 CI 中用 `--server=command`，命令结束时回收本次启动的工作区服务。
- 在 Linux 与 macOS 上直接使用发版归档，不需要 Rust 编译器、全局程序或数据库服务。

## 上手

以下在一个刚初始化、含一篇 Memory 的仓库里实际运行，摘要与路径因机器而异。连续检查两次，第二次命中缓存（节选）：

```sh
concord check
concord check
```

```text
check
ok: true
complete: true
findings: none
…
Cache: hit
```

查看缓存，再删除它：

```sh
concord cache status
concord cache clear
```

```text
sourceDigest: sha256:ca7a7bcd…
status: ready
path: /tmp/demo/.git/concord/cache.hawdb
detail: projections: annotation_cache, query_cache, workspace_projection
physicalBytes: 7418888
```

```text
status: cleared
path: /tmp/demo/.git/concord/cache.hawdb
```

删除后检索照常返回当前文件的内容：

```sh
concord memory search 缓存
```

```text
memory search
memory/cache-lesson.md — 删除缓存后检查结论不变
  # 删除缓存后检查结论不变 缓存只保存派生数据。清空后第一次检查重建缓存。
```

在 CI 里让命令自己回收工作区服务：

```sh
concord --server=command check
concord server status
```

```text
server status
state: absent
```

## 怎样工作

缓存放在 Git-private 目录的 `cache.hawdb` 中，不进入提交。复用前核对当前来源身份；Memory 与 Issue 在同一服务内复用未变化文件的已核验正文和摘要，变化文件才重读。文件新增、修改或删除后，对应投影更新；首次构建和服务重启完整核验来源。缓存缺失、损坏或被占用时，命令从源文件重新计算，结论不变。

查询命令自动启动该项目的工作区服务。服务长期持有缓存，CLI 与 Web 经由它读取，遵守同一套入口与生命周期约束。CI 使用 `--server=command`；此时项目已有工作区服务则明确失败，不结束其它客户端正在使用的服务（[适配项目的开发方式](../../taste.md#t-9)）。

`trace gaps`、`trace show` 与 `review` 默认读取后台构建的诊断[投影](../../concepts.md#projection)。它只回答构建时的诊断问题，标明构建时间与一致性，不授权 `check` 成功或证据裁决；`check`、检索和证据裁决总是使用当前来源。

句柄与清理的所有权、资源预算、诊断投影的刷新协议见[架构](architecture.md)，Memory 与 Issue 的节点和索引见[检索数据模型](data-model.md)，发行产物见[跨平台标签发版架构](../cross-platform-release/architecture.md#身份与复用)。

## 用户路径

- [使用、查看与清理缓存](use-case/use-unified-cache.md)
- [检索 Memory 与 Issue 时总是得到当前内容](use-case/query-current-projections.md)
- [读取后台刷新的诊断结果](use-case/query-asynchronous-projections.md)
- [工作区服务异常后恢复使用](use-case/recover-workspace-service.md)

命令的输出字段与错误见 [CLI](cli.md)。

## 范围与验收

- 缓存只加速：删除缓存不能删除 Spec、Memory、Issue 或证据，也不能改变 fixed 判定。
- 归档在支持的 Linux 与 macOS 上携带所需运行产物。目标平台缺少产物时明确诊断，不用另一个数据库冒充缓存引擎。
- 验收使用打包后安装到隔离 Git 仓库的 CLI，各 Use Case 的结果表列出要观察的情形。

高频操作的性能预算见[性能预算](performance.md)。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [总则](../../taste.md#general-amend)
- [写现在，不写过去](../../taste.md#t-4)
- [快到每次都愿意跑](../../taste.md#t-7)
