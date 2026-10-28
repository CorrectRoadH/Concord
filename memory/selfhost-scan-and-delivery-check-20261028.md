---
format: concord.document/v1
id: selfhost-scan-and-delivery-check-20261028
title: 自举扫描与交付门禁核验
createdAt: 2026-10-28T04:46:34.910Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 自举扫描与交付门禁核验

2026-10-28，在 master 471419a 上更新自举工程契约，并补齐 repository 源码范围。任务开始时已有 web/pages/git.tsx、web/pages/git/file-tree.tsx 和 web/styles.css 的修改；这些修改保留，未纳入本次提交。

## 调查修正与实现

此前审查说交付门禁没有检查当前项目契约，这个表述不准确。test/selfhost.test.ts 已经复制当前文档和源码到隔离 Git 消费者，执行 check 与 trace check；实际遗漏是 sourceRoots 和复制清单均没有 repository。

补齐 repository 后，当前 checkout 检查识别 378 个代码声明（原先 374），源码缓存扫描文件数由 197 增至 291。自举 smoke 按配置复制输入，并验证 repository/engine.ts 的声明进入扫描；仅在临时副本破坏该声明的契约引用后，公开 CLI 必须返回非零且 ok=false。

新增 check:selfhost 使用当前构建的 CLI 执行 --json --dry-run check，接入完整 check 与 CI 第一分片。CI 触发策略、运行时 API 和 Web 源码不在本次修改范围。契约见 docs/engineering/concord-self-hosting/README.md。

## 验证

- 初次 pnpm exec vp run check 在原生构建失败：当前 PATH 没有 cc，旧 Cargo 构建脚本引用的 Nix store 动态加载器已不可用。
- 使用本机已存在的 GCC 15.3 wrapper 与 binutils 路径，并通过 RUSTFLAGS 明确指定 linker 后，重新执行相同完整入口。未修改锁文件或跳过原生产物身份验证。
- 构建、类型检查和 check:selfhost 通过；自身检查为 122 个文档、431 个测试声明、378 个代码声明，findings 为空。自举 smoke 通过，包括失效引用反例。
- 完整测试结果：502 项，481 通过、14 失败、7 跳过。失败均来自 Web 服务或浏览器用例，表现为 fetch/ECONNRESET、元素可见性或导航时序断言。
- 保留同一 dist，使用 CONCORD_TEST_CONCURRENCY=1 pnpm exec vp run test:built --test-name-pattern=<完整失败标题的精确匹配> 及对应 10 个测试文件，串行复核全部 14 项失败用例：14 通过、0 失败、0 跳过。
- 完整运行的 7 项跳过：3 项原生 test-hook 场景、3 项 macOS 专属路径检查、1 项 Cargo adapter 编译探针（stable 工具链的 ld.lld wrapper 引用已不存在的 Nix store 路径）。

串行复核通过不改写完整运行失败的事实，也不表示完整门禁已通过。默认并发测试的稳定性仍待独立调查；本次不以扩大超时或删除断言处理。完整日志保存在本机 /tmp/concord-selfhost-check-20261028.log，定向复核日志为 /tmp/concord-selfhost-recheck-20261028.log；日志路径不是跨机器可用证据。
