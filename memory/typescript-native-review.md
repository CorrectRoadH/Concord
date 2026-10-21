---
format: concord.document/v1
id: typescript-native-review
title: TypeScript 原生 API 的输入和生命周期裁决
createdAt: 2026-10-21T12:27:46.755Z
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

原生 Codex / GPT-6.1 Sol 对 docs/design/typescript-native 的七页具体方案与 TypeScript 7.1.0-beta API 声明进行了只读独立挑战，结论无剩余阻断项。初稿的 p5 动态捕获与完整 VFS 矛盾，已通过 snapshot 前固定类型闭包消除；依赖配置 API 无 snapshot 参数，已采用专用 captured-host API。

采用补充约束：source map 必须解码为绝对坐标后删除改写 import 行再重编码；p5 闭包覆盖 ImportTypeNode、递归 re-export、相对 reference path；resolver 使用 containing directory；snapshot/resolver dispose 失败仍须关闭 API；同步 API 只能在调用返回后处理取消；受信 lib 必须真实进入完整输入，不能一面拒绝 host 一面依赖 host mount。

审查没有运行全量检查，不证明实现完成或性能达标。Linux 原型验证了完整 VFS、syntax diagnostics 和 AST 读取可用；100 个小文件约50ms仅为机制探针。实际 pnpm check、公开 CLI 预算和打包消费者另行验收。Review pane 已回收。


编辑器计算所有权补充审查：ts7-editor-review（原生 Codex / GPT-6.1 Sol）首轮指出取消与 ended guard 会吞掉清理失败，shutdown 等待 running 不足以证明成功。主 agent 修订 native-scopes 的 Editor computation owner，明确每 Job 独立 service/Scope、独立运行时注入、Scope 收尾后提取清理结论、严格 owned/checked/gone、缺记录失败与会话永久失败。复审 PASS，仅为设计收敛；未声称实现或生命周期测试通过。审查 pane w4W:p5D 已回收。
