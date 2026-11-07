---
relations:
  - role: spec
    target: docs/engineering/performance/cli.md
  - role: spec
    target: docs/engineering/performance/architecture.md
---
# Profile 私有归档无法完成采样

## 观察

`bench:profile` 复制归档后，`cache status` 报 `UnsafePath: Installation link escapes its dependency tree`。相对依赖链接被复制为指向共享候选的绝对链接，私有安装不再自包含。

## 期望行为

私有归档保留依赖 symlink 的原始内容，不修改共享候选或绕过路径校验。只有注入采样环境的进程进入汇总；这些进程必须同时具有 CPU 与 fs 证据，准备和清理产生的 CPU 文件不进入测量结果。

## 复现

运行 `bun run bench:profile local-data-engine/trace-gaps-refresh --consumer scale --scale 2,1,1 --warm`，或运行 `bun run gate test/domain/perf-profile-install.test.ts test/model/perf-profile-evidence.test.ts`。
