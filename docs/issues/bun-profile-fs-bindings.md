---
relations:
  - role: spec
    target: docs/engineering/performance/cli.md
---
# Bun profile 遗漏命名导入的文件调用

## 观察

编译程序通过 `node:fs` 和 `node:fs/promises` 的命名导入读取文件时，profile 计数器没有记录这些调用。完整扫描的 CPU 文件存在，fs 记录却为空，无法用于分析文件访问成本。

## 期望行为

计数器记录默认导入与命名导入的文件调用，并保持返回值和异常行为。

## 复现

运行 `bun run gate test/process/perf-profile.test.ts --test-name-pattern='compiled profile counts'`。实际编译程序完成两次同步读取和一次异步读取，输出原始内容并校验对应计数。
