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

作为在编辑器中写测试、代码与契约的开发者，我希望直接查看未保存标记的诊断，从标记跳到当前契约步骤，从步骤反查测试与实现，并补全契约路径与步骤 ID。

## 主流程

1. 编辑器以 `concord --root <worktree> lsp` 启动 stdio 会话，完成 initialize 与 initialized。服务只协商 UTF-16。
2. 编辑器通过 didOpen 提交全文、languageId 和整数版本。服务在会话内维护文本，未打开的依赖来自受校验磁盘快照。
3. didChange 使用递增版本，按顺序应用全文或 UTF-16 增量。步骤、源码标记、引用与写作政策共同使用同版输入。
4. 客户端读取带文档版本的 publishDiagnostics，并使用 definition、references、completion 与 hover 导航。
5. didSave 保留客户端文本；携带全文时须与缓冲区一致。didClose 清空诊断并移除缓冲区，重新打开取得新打开代次。
6. 客户端通过 shutdown、exit 或 stdin EOF 结束服务，服务取消任务并释放内存与句柄。

## 导航与诊断

定义返回当前契约、标题或步骤位置；引用返回当前显式测试与实现标记。references 的 includeDeclaration 决定是否包含目标位置。补全返回 canonical 契约路径与步骤引用，最多 2000 项；截断或输入不完整时 isIncomplete 为 true。

悬停显示当前正文或步骤，正文最多 32000 字符，并说明观察与执行证明的限制。服务不提供分析观察；这不表示没有关系，也不能证明测试执行或覆盖。

写作诊断复用目录政策与术语规则。打开的政策文件可提供未保存内容；配置授权以已保存的 concord.config.ts 为准，配置 overlay 改动返回 EditorConfigurationOverlayUnsupported。磁盘配置变化后必须使用新的授权上下文。

版本倒退、非法增量、重复打开或保存全文冲突使该 URI 无效并清空诊断，须关闭重开。旧任务不能覆盖或清空更高版本的诊断；过期请求返回 ContentModified（-32801），取消返回 RequestCancelled（-32800）。

输入不完整时发布 EditorInputsIncomplete，不能宣称项目全部通过。StepNotFound 仅在目标 Use Case 与步骤输入完整时产生。编辑器诊断不替代 concord check。

## 文件与资源边界

URI 只接受当前 worktree 的安全 file 路径，拒绝路径逃逸、符号链接、Git 私有目录与 node_modules。合法新文件可以只存在于缓冲区，服务不把文本写入磁盘或持久缓存。

删除已打开文件保留其未保存文本，并明确标记磁盘依赖缺失。didRenameFiles 使旧 URI 无效，客户端须关闭旧 URI 并打开新 URI；服务不猜测文本迁移。didDeleteFiles 与 didChangeWatchedFiles 使依赖计算失效；请求返回前仍须复核磁盘身份。

每个会话最多打开 64 个文档，单文档最多 2 MiB，全部 overlay 最多 16 MiB。并发计算最多 8 个，每任务限时 30 秒；读取成员最多 10000 项、正文合计最多 64 MiB。每会话最多 100000 条消息。单消息最多 4 MiB，输入缓冲最多 8 MiB，待输出最多 8 MiB；超过预算返回 EditorBudgetExceeded 或终结无法继续的传输。

## 验收

- 同时修改未保存步骤、测试引用与实现标记时，诊断、跳转、引用、补全与悬停使用一致版本，支持未落盘新文件。
- 非 BMP 文本增量按 UTF-16 换算；越界、倒退、取消、关闭重开与迟到结果遵守代次淘汰。
- 保存不覆盖缓冲区；磁盘配置、政策、删除与重命名使受影响结果失效或明确不完整。
- 服务只读，只提供文档生命周期、诊断和上述四种导航。编辑、格式化、codeAction、executeCommand 与 willRenameFiles 请求以 EditorMethodNotSupported 拒绝。
- 服务不开网络端口，不启动 language server、测试收集器或 runner。stdout 只包含 framed JSON-RPC，stderr 用于具名诊断。
- shutdown、exit、EOF 与 SIGINT 取消任务并释放会话资源，不持 publication lease 等待客户端。

详细生命周期见[编辑器服务](../../../design/lsp-integration/plans/lsp-client/architecture.md#编辑器服务)。
