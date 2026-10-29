---
imports:
  - docs/feature/feedback/concepts.md#index
  - docs/feature/feedback/concepts.md#recall
deprecated:
  cache-namespace: [缓存命名空间]
  ownership-guard: [所有权守卫]
---

# 本地数据引擎术语

本页定义统一数据引擎中的术语，并引用反馈功能的 Index 与 Recall。

## Cache {#cache}

可丢弃的派生数据；其缺失或失效不改变事实 owner，复用前核对当前来源身份。

## Projection {#projection}

从权威输入生成的结构化表示，保留来源身份和代次，不拥有独立的领域事实或授权结论。

## Cache namespace {#cache-namespace}

统一数据引擎内区分缓存种类与预算的存储分区，不等同于文档目录的术语作用域。

## Ownership guard {#ownership-guard}

覆盖整个缓存清理过程的目录所有权锁；取得该锁才允许删缓存数据，锁文件及其 inode 保留。
