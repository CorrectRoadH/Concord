---
relations:
  - role: spec
    target: docs/engineering/performance/cli.md
  - role: spec
    target: docs/engineering/performance/architecture.md
---
# Profile 汇总混入已经退出的预热进程

## 观察

场景的 `--warm` 使用带计数环境的 context，预热进程退出后留下 counter。汇总把它与实际 run 一同纳入，但 `wallMs` 只属于实际 run。

## 期望行为

真正 run 前已经写出的准备和预热 counter 不进入汇总，原始文件保留。长期服务在收尾才写出 counter，因此仍进入汇总。实际采样 counter 缺少 CPU、排除准备证据后没有本次测量证据，均失败。

## 复现

运行 `bun run bench:profile local-data-engine/trace-gaps-refresh --consumer scale --scale 2,1,1 --warm`，汇总中出现两次扫描主进程。定向回归为 `bun run gate test/model/perf-profile-warm.test.ts`。
