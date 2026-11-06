# 本地数据引擎术语表

本页定义统一数据引擎中的概念。[投影](../../concepts.md#projection)与[快照](../../concepts.md#snapshot)由[全局术语表](../../concepts.md)定义。

## Cache {#cache}

可丢弃的派生数据；其缺失或失效不改变事实 owner，复用前核对当前来源身份。

## Cache namespace {#cache-namespace}

统一数据引擎内区分缓存种类与预算的存储分区，不等同于概念与写作规则在文档目录中的生效范围。

## Ownership guard {#ownership-guard}

覆盖整个缓存清理过程的目录所有权锁；取得该锁才允许删缓存数据，锁文件及其 inode 保留。

## 历史投影 {#historical-projection}

后台异步刷新、保存在 HawDB 中的[投影](../../concepts.md#projection)，带构建时间、来源一致性与完整性标注。它不表示当前来源有效，不授权 check 成功、写入、恢复或证据裁决。

导航与诊断查询可以读取历史投影；需要当前结果时用当前来源查询，例如 `--fresh`。
