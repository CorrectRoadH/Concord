---
relations:
  - role: spec
    target: docs/engineering/performance/cli.md
---
# 编译产物的 profile 无法加载计数脚本

## 观察

`bun run bench:profile local-data-engine/trace-gaps-refresh --warm` 在准备消费者时失败，报 `preload not found`。编译参数将 JSON 字符串的引号当成了路径的一部分。

## 期望行为

profile 加载计数脚本，并在指定目录生成 CPU 采样文件，供[性能定位](../engineering/performance/cli.md)读取。

## 复现

运行 `bun run gate test/process/perf-profile.test.ts`。用例使用正式 profile 参数编译一个小型 Bun 程序，运行后核对 preload 的输出与 CPU 采样文件。
