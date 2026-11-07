---
relations:
  - role: spec
    target: docs/feature/local-sdlc/performance.md
---

# CLI 启动超出帮助的预算

## 现象

构建自 80d7bd7 的安装版 CLI，负载约 5 时：`concord --help` 331ms、`concord --version` 331ms、`concord test --help` 313ms，`local-sdlc/help` 的预算是 50ms。打包自带的 Node 空跑约 20ms；单独加载 `effect` 根入口 180–200ms，其中 `effect/Effect` 约 70ms、`effect/Schema` 约 125ms。`src` 中有 220 个文件从 `effect` 根入口导入，46 个使用子路径。

## 期望

`local-sdlc/help` 的 p50 不超过[性能预算](../feature/local-sdlc/performance.md)。先 profile 安装版 CLI 的启动，分出 Node 启动、模块加载（按包）、命令解析与输出各自的耗时，再改占比最大的一段；不提高预算。
