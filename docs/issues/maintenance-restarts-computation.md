---
relations:
  - role: spec
    target: docs/feature/local-data-engine/architecture.md
---

# 服务的缓存维护每 30 秒重启计算进程

## 现象

NiceEval 的 `cache.hawdb` 物理体积 67,017,580 字节，超过 48 MiB。服务的自动维护每 30 秒进入 draining，等包括后台刷新在内的操作排空后，调用 `main.ts:349` 的 close，把前台计算、后台计算与操作进程全部关闭重建（`lead9-niceeval-query-observation.json`）。热解析缓存随之丢失，排空期间前台请求等待后台完成；同一项目的默认 `test list` 依次为 3.7 秒、3.7 秒、35.6 秒。

## 期望

按[目录体积与维护](../feature/local-data-engine/architecture.md#目录体积与维护)：只在没有前台请求时维护，前台请求到达时维护让出；回收只重开主进程的持久句柄，不重启两个计算进程；回收后仍在上限内时，只在体积再增长 16 MiB 以上或超过上限时再次维护。先写失败回归，再按 `--fixed` 修复。
