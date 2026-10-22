---
format: concord.document/v1
id: release-012-validation
title: 0.12 发布验证与缓存关闭回归
createdAt: 2026-10-22T02:47:27.307Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

2026-10-22 为四项方案、编辑器服务与 TypeScript 7 beta 集成执行发布验证。

发布前发现并修正两类回归：

- 浏览器使用单个 InvalidData 文案定位，但同一 malformed owner 可以产生多条字段诊断。断言改为限定损坏文档路径并验证至少一条对应诊断可见，保留恢复阻断及健康未知场景。
- 新增写作 findings 缓存默认持久化。doctor、聚合 check 以及 docs/writing check 的 dry-run 调用未完整传递关闭缓存的意图，导致本应只读的工作区扫描创建缓存，或回放未完成的 WAL。调用链显式传递 cache off/dry-run；既有 cache-off/WAL 回归用于验证，扩展 dry-run 回归覆盖 docs check 与 writing check。

CI 环境补充 Go 1.26.7、uv 0.12.5 和 pytest 9.1.1 的离线准备。Cargo 消费者以实际 +stable 的版本建立精确 frameworkVersion，收集和执行收据均核对该值。CI 缺少框架或编译能力时失败，不将跳过当作验收。原生引擎的固定 Rust 版本不变。

本地已完成：pnpm typecheck；浏览器定位回归 4/4；feedback、view-browser、view-projection 与 release-workflow 定向回归 33/33；真实打包 Vitest、pytest、Go、Cargo、Node 适配器一组验收通过且无跳过。Cargo 本机采用已安装 GCC wrapper，并仅为测试进程配置 RUSTFLAGS=-C link-arg=-fuse-ld=bfd，以绕过本机失效的 LLD 包装器。

上述是定向验证，不表示完整发布 CI 已通过。最终 CI、版本标签与渠道同步结果在发布完成后追加。本轮未扩大 scale 性能验收，也不声称受控写作规则符合 ASD-STE100。
