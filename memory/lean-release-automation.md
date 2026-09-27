---
format: concord.document/v1
id: lean-release-automation
title: 快速发布与无人值守渠道同步
createdAt: 2026-09-27T14:18:30.430Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

# 快速发布与无人值守渠道同步

用户要求一次构建发布、减少平台与 CI 时间，最终明确自动 CI 不需要真实安装。该决定替代 0.8.2 最初的多平台测试发布门禁。

标签调度默认分支上的 Release，源码 checkout 显式使用标签。这样 Cargo 缓存可跨版本复用；只构建 Linux x64/glibc 和 Apple Silicon macOS 15 两个原生目标，然后一个 Ubuntu 任务构建、类型检查并只 pack 一次。版本、原生集合、身份和 SHA-256 不一致仍阻断发布。自动发布不运行测试或安装 Concord，完整 Check 保留为本地或手动入口，不把构建成功解释成运行时验收。

公开 tap 自动发现版本，核对包与 shrinkwrap 版本及资产摘要，生成 Formula/Nix 元数据，提交和标记渠道映射并创建渠道收据。没有平台安装任务。版本和摘要已一致时跳过下载与 Nix 依赖哈希生成，仍可补齐中断的收据。首次失败仅自动重跑失败任务一次；后续定时发现可恢复未完成同步，不设永久冷却。通知 token 缺失时定时发现仍工作，不依赖 LLM。相同版本的不同资产摘要不能覆盖。

0.8.2 已发布，源提交 1439ee7ff3fd04d05b8bf9d4e67c1ac5fc35b1b5，资产 SHA-256 db480f41a7c8c0797d9d1dcdcdd97daea955a29e363870787af09e4f84a8077e。原发布运行 36323787728 的 Linux 分片、macOS 26 smoke、macOS 15 可移植与 npm 安装检查通过；macOS 15 深层验证因 opt 符号链接路径比较失败。人工复用同一候选发布，未声称原运行全绿。验证器现使用 realpath，符号链接消费者回归已通过。tap 运行 36324909232 在 3 分 26 秒内完成原渠道安装检查并提交 cffebf3。这些历史检查不再属于后续自动发布门禁。

独立 Herdr GPT-6 Sol review 复核后给出 PASS；早期冷却策略可能永久挡住瞬时准备失败，现已删除冷却与重试排除。该复核为静态检查。macOS 最低版本 15；macOS 27 允许安装，但未进行该系统实测。
