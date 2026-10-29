---
format: concord.document/v1
id: cli-hot-path-measurements-20261029
title: CLI 热路径与 HawDB 进程模型的实测
createdAt: 2026-10-29T22:06:10.846Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# CLI 热路径与 HawDB 进程模型的实测（2026-10-29）

参照机器 AMD Ryzen 7 5800X、Linux x64、Node 24.19.0，本仓库缓存已热。

## 起点

- `check` 2.9 s、`doctor` 5.4 s、`docs check` 1.1 s、`--version` 约 310 ms（`node -e 0` 30 ms）。
- `--version` 的约 280 ms 中约 210 ms 是加载 121 个 dist ESM 模块与 effect。
- 本仓库 `cache.hawdb` 约 470 MB（按 inode 去重），`openHawdb` 1118 ms；新克隆 8.4 MB 时 57 ms。
- 读取全部 934 个来源并计算 sha256 约 14 ms，所以不值得用 stat 指纹代替读取；独立审查还给出了粗粒度时间戳下返回陈旧摘要的反例。

## 根因

HawDB 规定一个目录只由一个进程打开（固定 revision README 第 153 行）。Concord 让短命进程轮流打开，并以 `default-features = false` 关闭了后台维护与全文检索。

## 实测结论

- 静态版本与帮助：p50 从约 286 ms 降到 44 ms；234 份输出与原 CLI 逐字节一致。按命令组加载后 `memory index` 435 → 394 ms。最小 Effect CLI 打包后仍约 73 ms，真实命令在 CLI 进程内的固定开销最好约 139 ms，因此其余命令要到 50 ms 只能在常驻进程里执行。
- 持久解析投影在每命令打开数据库时是净损失：缓存 8 → 80 MB，`docs check` +46%，`memory index` +72%。撤下后只保留进程内单次解析，三条命令与改前持平（±1%）。
- 启用 background-maintenance 并长期持有句柄：约 60 s 完成自动 checkpoint，150 s 内不回收旧根页与不可达对象。2000 次写入后长期持有 90.55 MiB，关闭时显式 reclaim 22.21 MiB；不回收组 2,187 MiB / 44,194 文件、打开 128 ms，每次回收组 24 MiB、打开 22 ms。内联 reclaim p50 27 ms、p95 241 ms，所以放进 detached 维护进程（48 MiB 触发，回收后仍超 224 MiB 才丢弃）。
- 另一个进程只读打开同一目录：经绑定立即 HawdbBusy，直接用引擎接口第一次读取即 BranchBusy。

spike 提交保留为 `refs/spikes/startup` 与 `refs/spikes/reclaim`。
