---
relations:
  - role: spec
    target: docs/feature/portable-coordination/architecture.md
---

# 无法解码的陈旧 journal 阻止恢复

## 现象

`src/base/workspace/storage.ts` 的通用恢复在入口严格解码 `journal.json`，格式无法解码时报错并保留文件；`test/domain/storage.test.ts` 断言这一行为。遗留这种 journal 的仓库每次恢复都失败。

## 期望

按[写入协调与恢复](../feature/portable-coordination/architecture.md)：`journal.json` 属于无法解码的陈旧格式时，保留磁盘上的当前文件，清理该 journal 并输出告警，绝不锁死仓库。回归：放入一份无法解码的 journal，恢复成功返回告警，目标文件不变，journal 被删除。
