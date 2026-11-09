---
relations:
  - role: spec
    target: docs/feature/web-workbench/use-case/use-web-workbench.md
---
# 取消排队计算的进程测试偶发超时

## 观察

`test/process/workspace-computation.test.ts` 的排队计算取消用例（scan-child-termination-releases-exact-token）偶发在 30 秒期限超时。同文件的空闲进程复用用例随后失败。v0.15.0 的 Release 运行 42435757015 第 13 分片因此失败。用固定 Bun 1.4.4 在本机连续运行三次，第三次复现。

## 期望行为

取消排队计算与回收其所有者进程组在期限内稳定完成，测试结果不依赖调度时序。

## 复现

重复运行 `bun run test test/process/workspace-computation.test.ts`，若干次内出现 30 秒超时。
