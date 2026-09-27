---
format: concord.document/v1
id: cli-startup-performance
title: CLI 启动性能测量与瓶颈
createdAt: 2026-09-27T02:23:48.225Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# CLI 启动性能测量（启动优化）

参照：commit 6346f4cf78bc3553448a0119443f8f2ec681f5d5 的独立 clone；AMD Ryzen 7 5800X，Linux x64，Node v24.19.0；warm cache；新旧产物交错各 6 次，取 p50。样本数少于性能验收要求的 7 次，属于探索性数据。

| 命令 | 优化前 ms | 优化后 ms |
|---|---:|---:|
| `--help` | 626 | 292 |
| `memory index` | 777 | 454 |
| `memory list` | 762 | 451 |
| `issue list` | 738 | 399 |
| `feature list` | 839 | 504 |
| `trace show docs/feature/local-sdlc/README.md` | 1404 | 1082 |
| `docs check` | 1131 | 830 |
| `check`（不含写作门禁） | 1337 | 1054 |

瓶颈：模块加载占 `memory index` 约 570ms。优化手段为构建期把 effect 等固定版本 namespace barrel 导入改写为公共子路径，以及 Markdown parser 首次使用时加载；模块加载降至约 250ms。其余成本来自 8 次 Git 调用（约 25ms）、8 次 lease fsync（约 30ms）、HawDB 打开（约 37ms）与 owner 扫描，均属必需校验。

`test/cli-startup.test.ts` 保护只读命令不加载整包 barrel、Markdown parser 或 TypeScript 编译器。

## 交付复测：聚合写作门禁

候选为 commit 5156416800cc76bed13486e82eff5c7f73d5b2f0 的构建产物；基线为父提交 6346f4cf78bc3553448a0119443f8f2ec681f5d5 的 v0.7.8 Release 包。冻结消费者是该父提交的独立 Git clone。AMD Ryzen 7 5800X、Linux x64、Node v24.19.0；两套产物分别预热后交错运行，每个命令各 7 个新进程，stdout/stderr 重定向到文件，表中为 wall-time p50。

| 命令 | 基线 ms | 候选 ms | 候选 cold ms | 候选预算 ms |
| --- | ---: | ---: | ---: | ---: |
| `--help` | 581 | 272 | — | 350 |
| `memory index` | 704 | 391 | 540 | 550 |
| `issue list` | 688 | 374 | 514 | 500 |
| `feature list` | 800 | 473 | 631 | 600 |
| `trace show docs/feature/local-sdlc/README.md` | 1373 | 916 | 2264 | 1300 |
| `docs check` | 1091 | 790 | 921 | 1000 |
| `check` | 1340 | 1378 | 2638 | 2300 |

所有候选 warm p50 均低于预算；各组最大样本不超过该组 p50 的 1.11 倍。未变更检查范围的命令均无超过 20% 的同机回退。父提交的文档包含 169 条写作 finding：`docs check` 两版均退出 1；基线 `check` 只检查关系而退出 0，候选还检查写作而退出 1。因此 `check` 的退出码差异是本次契约变化，其 p50 只与新增聚合预算比较，不作为等价输出的回退比例。cold 仅记录，不参与 warm 预算判定。
