# 本地数据引擎术语表

本页定义统一数据引擎中的概念。[投影](../../concepts.md#projection)与[快照](../../concepts.md#snapshot)由[全局术语表](../../concepts.md)定义。

## 缓存 {#cache}

可丢弃的派生数据；其缺失或失效不改变事实 owner，复用前核对当前来源身份。

## 缓存命名空间 {#cache-namespace}

统一数据引擎内区分缓存种类与预算的存储分区，不等同于概念与写作规则在文档目录中的生效范围。

旧写法：`Cache namespace`

## 检索投影 {#knowledge-search-projection}

从当前 Memory 或 Issue 文件派生、由 HawDB 保存正文并维护文本索引的数据。两种文件各有独立的完整性边界；只有完成当前来源核对的一整组记录可以用于搜索，不能用部分缓存回答完整集合的查询。

## 检索代次 {#knowledge-search-generation}

一次完整来源核对所对应的检索投影身份。它绑定文件集合、来源摘要、解析器与文本归一化规则；查询固定一个代次，不能混合不同代次的记录。数据库事务提交成功只表示投影写入成功，不单独证明文件仍是当前内容。

## 清理守卫 {#ownership-guard}

清理期间同时持有的锁集合：Concord 准入锁，加上根、分支目录元数据与全部现有分支、runtime、root-pins 及数据目录的引擎锁。全部取得并核对完整目录集合后才允许删缓存数据，锁 inode 及承载它们的目录保留。

旧写法：`Ownership guard`

## 历史投影 {#historical-projection}

后台异步刷新、保存在 HawDB 中的[投影](../../concepts.md#projection)，带构建时间、来源一致性与完整性标注。它不表示当前来源有效，不授权 check 成功、写入、恢复或证据裁决。

导航与诊断查询可以读取历史投影；需要当前结果时用当前来源查询，例如 `--fresh`。
