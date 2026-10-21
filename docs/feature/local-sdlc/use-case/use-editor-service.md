---
format: concord.document/v1
id: use-editor-service
title: 在编辑器中查看 Concord 关系
createdAt: 2026-10-21T09:27:54.427Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 在编辑器中查看 Concord 关系

## 场景

作为在编辑器中写测试、代码与契约的开发者，我希望不离开编辑器就看到标记诊断，从标记跳到契约步骤，从步骤反查测试与实现，并补全契约路径与步骤 ID。

## 主流程

1. 编辑器以 stdio 启动 `concord lsp`。
2. 打开或修改文件时，服务基于未保存内容发布标记、步骤与写作诊断。
3. 定义、引用、补全与悬停使用同一版本的打开文档与磁盘快照。

## 验收

- 服务只读，不注册编辑能力，不启动外部分析进程，不开网络端口。
- 文档生命周期、版本淘汰与不完整结果的处理见[编辑器服务](../../../design/lsp-integration/plans/lsp-client/architecture.md#编辑器服务)。
