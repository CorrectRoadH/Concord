---
format: concord.document/v1
id: release-082-platform-baseline
title: 0.8.2 平台基线与发布去重
createdAt: 2026-09-27T13:50:01.763Z
kind: memory
memoryKind: decision
state: superseded
epoch: 0
promotions: []
history:
  - at: 2026-09-27T14:18:31.226Z
    action: supersede
    reason: 用户要求发布CI精简为构建与安装冒烟，并自动完成调度及渠道同步
    ref: memory/lean-release-automation.md
supersededBy: memory/lean-release-automation.md
---

# 0.8.2 平台基线与发布去重

用户明确要求以 0.8.2 发布新的支持范围，并修复 macOS 27 无法从 Homebrew 更新的问题。源码 v0.8.1 已发布，tap 停留 0.8.0；同步运行 36320834870 与 36321744511 均在 macOS 14 安装 Homebrew 依赖 simdutf 时源码编译失败，未到 Concord 安装验收。Homebrew 2026-09 支持政策将 Apple Silicon macOS 14 列为 Tier 3，不再提供新的 bottle。

采用 Apple Silicon macOS 15+、部署目标 15.0；Linux x64/glibc、Node >=24.15.0、HawDB revision、ABI 和持久格式不变。源码 macOS 15 完整可移植及真实 Homebrew 安装验收，macOS 26 同包冒烟。tap 在 Ubuntu24、macOS15/26 验证 Formula，Ubuntu24 验证 Nix。macOS27 允许安装，当前 CI 没有该平台实测，不声明已验收。既有发布资产和标签不覆盖。

独立 design_grill：首次 Herdr Claude Code Opus5.5 返回 HTTP402 无有效套餐/余额，没有产出审查；用户明确授权改用 GPT-6 Sol。独立只读 reviewer release082-sol（Herdr w4W:p4E，GPT-6 Sol high，session 01a0e31a-d4a6-7880-a73b-a49724c9cec0）读取契约、实现与两个工作流后结论 PASS，无阻断项。旧 Darwin 不另加全局拒绝：支持政策和 Formula 最低版本明确，原生加载失败已有具名 HawdbUnavailable。

审查确认可取消同一 release commit 的普通 Check，前提是完成全部 Release gates；Release 包含类型检查、原生恢复、完整测试分片与平台安装检查。两个原生目标构建后只生成一个 tgz，Homebrew/Nix 使用同一发布资产。保留渠道专属安装测试，不把源码 Release 成功当作渠道同步成功；有活跃的自动 tap 同步时不重复 dispatch。

发布前针对性验证：发布工作流回归 2/2 通过；源码与脚本 TypeScript 检查通过；两个 YAML 和30个 shell 块语法通过；Concord check complete=true、findings=[]。完整平台发布验收与用户实际 macOS27 验收尚待运行，以上不构成已发布声明。
