---
format: concord.document/v1
id: hawdb-integration
title: HawDB 接入边界与上游证据
createdAt: 2026-09-23T04:17:23.353Z
kind: research
sources:
  - https://github.com/nowledge-co/hawdb
---

# HawDB 接入边界与上游证据

## 上游事实

核验源码 revision 为 1e9f76428be6649a18a6f99d75b0ccfef16bf545。HawDB 是嵌入式 Rust 图数据库，公开 facade 提供参数化 Cypher、关系查询、事务及搜索能力。该 revision 的 Cargo 与 rust-toolchain 声明 Rust 1.97.1；仓库未提供 Node N-API 包。

[源码](https://github.com/nowledge-co/hawdb/tree/1e9f76428be6649a18a6f99d75b0ccfef16bf545)与 [embedded runtime contract](https://github.com/nowledge-co/hawdb/blob/1e9f76428be6649a18a6f99d75b0ccfef16bf545/docs/specs/EMBEDDED_RUNTIME_SPEC.md)要求一个持久目录同时仅有一个进程和 root handle；生产应用使用进程内 library API，不能依赖 HawDB CLI、helper 进程或环境控制面。

## Concord 的现有边界

SQLite 当前拥有 annotation_cache、code_cache、config_cache 与 feedback_cache 四类可重建投影。源码和 Markdown/JSON 仍是事实来源；远端反馈缓存丢失后仅能通过显式 fetch 刷新，离线本地 Issue 不依赖缓存。

LocalRepository 以短快照 lease 保护来源读取与提交，构造后不保留全命令锁。迁移引擎必须保留此生命周期。现有 ContentCache 是按当前源字节校验且有容量上限的进程内纯解析 memoization；用户要求这一类缓存也使用 HawDB。该要求覆盖文档和代码解析，仍须保持容量与当前来源校验。

现行发行契约要求同一个 tgz 通过 Linux 和 Apple Silicon macOS 安装验收。Rust 桥接引入平台产物与 c-005 的窄例外；是否采用必须以真实构建及独立设计挑战为依据，不能由本研究事实自动推出。

## 原生可行性证据

Node 24.19.0 通过 N-API 调用真实公开 Database facade 的隔离探针验证了四个 namespace、参数化 SQL 字节读写、批量事务、失败回滚、关闭后重开。Database::new 内存实例验证了 namespace 隔离、按条目数裁剪和清理，未生成磁盘文件。原型未启用默认特性，未测试 BM25 或向量；结果不能声称搜索语义或 Concord 集成已经完成。

固定 napi 3.13.0、napi-derive 3.6.9，stripped release 产物为 20,062,528 bytes。单次本机粗测使用 1000 条、每条 8,683 bytes：单事务批量写约 302 ms，逐条事务写约 1207 ms，首次/重复完整读取约 69/74 ms，已有数据库重开约 90 ms。此数据不包含真实 Concord 对象解码与完整请求，也不是断电冷启动或跨平台性能保证。

本机产物依赖 Nix glibc/libgcc，不能直接当通用 Linux 包。生产桥接必须补齐路径和大小边界、具名错误、Schema 验证及资源释放；不能照搬原型的“任何表读取错误都尝试建表”。普通事务回滚不能替代强制中断恢复验收。
