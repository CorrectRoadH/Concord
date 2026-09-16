> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代，不代表当前支持。

# 初始化配置与项目治理契约

## 状态

已通过 `concord design decide` 采用 compatible。独立只读 design_grill 的四项有限条件已落实，具体边界见 plans/compatible/governance.md。

## 已采用

TS 的允许语法与安全加载、旧配置兼容、Memory 多来源身份与证据边界、宪法修订与恢复协议。

正文不替代 owner metadata 中的裁决。主仓库集成已通过完整 `pnpm check` 132 项测试，并完成实际终端确认冲突与自身宪法采用验证。
