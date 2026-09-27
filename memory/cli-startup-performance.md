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
