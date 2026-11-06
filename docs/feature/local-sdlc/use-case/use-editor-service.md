# 在编辑器中查看 Concord 关系

## 用户目标

在编辑器里写测试、代码与 Spec 的开发者，想在保存之前就看到标记写错的诊断，从标记跳到它指向的 Spec 步骤，从步骤反查测试与实现，并补全 Spec 路径与步骤 ID。

## 起始状态

- 仓库里有 [把测试关联到 Use Case 步骤](link-tests-to-steps.md) 中的 `docs/feature/cart/use-case/add-item.md`，其中第 2 步的 ID 是 `add`。
- 编辑器能通过 stdio 连接 Language Server Protocol 服务，例如为 Markdown、TypeScript 等文件配置一个自定义 language server。

## 完整路径

以下消息是编辑器与服务之间的 JSON-RPC 正文，省略了 `Content-Length` 帧头；仓库位于 `/tmp/cart`。

1. 启动会话。 {#start}

   编辑器运行 `concord --root <worktree> lsp`，发送 `initialize`，再发送 `initialized`。服务只协商 UTF-16：

   ```json
   {"jsonrpc":"2.0","id":1,"result":{"capabilities":{"positionEncoding":"utf-16","textDocumentSync":{"openClose":true,"change":2,"save":{"includeText":true}},"definitionProvider":true,"referencesProvider":true,"completionProvider":{"triggerCharacters":["/","#"]},"hoverProvider":true},"serverInfo":{"name":"Concord editor"}}}
   ```

2. 打开文件。 {#open}

   `didOpen` 提交全文、languageId 和整数版本。这里打开的测试文件指向一个不存在的步骤 `#checkout`，服务发布带版本的诊断：

   ```json
   {"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///tmp/cart/test/cart.test.ts","version":1,"diagnostics":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"severity":1,"code":"StepNotFound","source":"concord","message":"Anchor checkout does not exist in docs/feature/cart/use-case/add-item.md"}]}}
   ```

   服务在会话内维护打开的文本；没打开的依赖来自受校验的磁盘快照。

3. 不保存，直接改正。 {#edit}

   `didChange` 用递增的版本 2 把 `#checkout` 改成 `#add`。服务按顺序应用全文或 UTF-16 增量，步骤、源码标记、引用与写作规则都使用同一版输入：

   ```json
   {"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///tmp/cart/test/cart.test.ts","version":2,"diagnostics":[]}}
   ```

4. 在标记和步骤之间导航。 {#navigate}

   在标记上请求 `definition`，得到步骤所在的位置：

   ```json
   {"jsonrpc":"2.0","id":2,"result":[{"uri":"file:///tmp/cart/docs/feature/cart/use-case/add-item.md","range":{"start":{"line":9,"character":0},"end":{"line":9,"character":0}}}]}
   ```

   打开 Use Case，在第 2 步上请求 `references`（`includeDeclaration: false`），得到指向它的测试与实现标记（节选）：

   ```json
   {"jsonrpc":"2.0","id":5,"result":[{"uri":"file:///tmp/cart/test/cart.test.ts","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}}},{"uri":"file:///tmp/cart/src/cart.ts","range":{"start":{"line":1,"character":0},"end":{"line":1,"character":0}}}]}
   ```

   在标记里输入 `#` 时请求 `completion`，得到 canonical Spec 路径与步骤引用（节选）：

   ```json
   {"jsonrpc":"2.0","id":6,"result":{"isIncomplete":false,"items":[{"label":"docs/feature/cart/README.md","kind":18,"insertText":"docs/feature/cart/README.md","detail":"Concord canonical reference"},{"label":"docs/feature/cart/use-case/add-item.md#add","kind":18,"insertText":"docs/feature/cart/use-case/add-item.md#add","detail":"Concord canonical reference"}]}}
   ```

   在标记上请求 `hover`，显示步骤正文和证明范围的说明：

   ```json
   {"jsonrpc":"2.0","id":7,"result":{"contents":{"kind":"markdown","value":"**docs/feature/cart/use-case/add-item.md#add**\n\n2. 点“加入购物车”。 {#add}\n\nConcord source relations only. Analysis observations are not provided; this does not establish absence of relationships or execution coverage.\n\nInput complete: true."}}}
   ```

   `definition` 返回当前 Spec、标题或步骤的位置；`references` 返回当前显式的测试与实现标记，`includeDeclaration` 决定是否包含目标位置。`completion` 最多返回 2000 项，截断或输入不完整时 `isIncomplete` 为 true。`hover` 的正文最多 32000 字符。服务不提供分析观察，这不表示没有关系，也不能证明测试执行或覆盖。

5. 保存与关闭。 {#save-close}

   `didSave` 保留客户端文本，携带全文时须与缓冲区一致。`didClose` 清空该文件的诊断并移除缓冲区；重新打开时取得新的打开标识。

6. 结束会话。 {#shutdown}

   编辑器发送 `shutdown` 再发送 `exit`，或关闭 stdin。服务取消任务并释放内存与句柄：

   ```json
   {"jsonrpc":"2.0","id":4,"result":null}
   ```

   收到 `exit` 后进程以 0 退出。

## 结果

保存之前，诊断、跳转、引用、补全与悬停都反映编辑器中的当前文本，包括还没写到磁盘的新文件。编辑器诊断不替代 `concord check`。

| 情形 | 结果 |
| --- | --- |
| 同时未保存地修改步骤、测试引用与实现标记 | 诊断、跳转、引用、补全与悬停使用一致版本 |
| 同时未保存地修改步骤 ID 与测试引用 | 新 ID 的引用有效，不从旧磁盘图发出 `StepNotFound` |
| 新版本确有缺失的步骤，而旧任务的结果迟到 | 旧结果被淘汰，不覆盖或清空更高版本的诊断 |
| 输入不完整 | 发布 `EditorInputsIncomplete`，不宣称项目全部通过；`StepNotFound` 只在目标 Use Case 与步骤输入完整时产生 |
| 版本倒退、非法增量、重复打开，或保存的全文与缓冲区不同 | 该 URI 无效并清空诊断，须关闭后重新打开 |
| 非 BMP 文本的增量 | 按 UTF-16 换算 |
| 越界、倒退、取消、关闭重开后迟到的结果 | 按打开标识淘汰：标识不同的结果直接丢弃 |
| 请求过期 | `ContentModified`（-32801） |
| 请求被取消 | `RequestCancelled`（-32800） |
| 写作诊断 | 复用目录政策与术语规则；打开的政策文件可以提供未保存内容 |
| 在编辑器中修改 `concord.config.ts` 而未保存 | `EditorConfigurationOverlayUnsupported`；配置授权以已保存的文件为准，磁盘配置变化后使用新的授权上下文 |
| 磁盘上的配置、政策变化，或文件被删除、重命名 | 受影响的结果失效或明确标为不完整 |
| 编辑、格式化、`codeAction`、`executeCommand` 与 `willRenameFiles` 请求 | `EditorMethodNotSupported`（-32601），例如 `{"code":-32601,"message":"Read-only editor does not support textDocument/formatting","data":{"name":"EditorMethodNotSupported"}}` |

服务只读，只提供文档生命周期、诊断和上述四种导航。它不开网络端口，不启动 language server、测试收集器或 runner；stdout 只包含 framed JSON-RPC，stderr 用于具名诊断。`shutdown`、`exit`、EOF 与 SIGINT 都取消任务并释放会话资源，不持发布租约等待客户端。

## 文件与资源边界

URI 只接受当前 worktree 的安全 file 路径，拒绝路径逃逸、符号链接、Git 私有目录与 node_modules。合法新文件可以只存在于缓冲区，服务不把文本写入磁盘或持久缓存。

删除已打开文件保留其未保存文本，并明确标记磁盘依赖缺失。didRenameFiles 使旧 URI 无效，客户端须关闭旧 URI 并打开新 URI；服务不猜测文本迁移。didDeleteFiles 与 didChangeWatchedFiles 使依赖计算失效；请求返回前仍须复核磁盘身份。

每个会话最多打开 64 个文档，单文档最多 2 MiB，全部 overlay 最多 16 MiB。并发计算最多 8 个，每任务限时 30 秒；读取成员最多 10000 项、正文合计最多 64 MiB。每会话最多 100000 条消息。单消息最多 4 MiB，输入缓冲最多 8 MiB，待输出最多 8 MiB；超过预算返回 EditorBudgetExceeded 或终结无法继续的传输。

计算任务与原生编译器由独立 POSIX 进程组拥有。Linux 与 macOS 支持该计算入口；Windows 在启动任务前返回 EditorTaskFailed。清理未知或失败使会话停止新计算，shutdown 返回 EditorTaskFailed，EOF 与 exit 非零退出；取消回复不代表清理已成功。

## Spec 来源

- 方法与错误：[编辑器服务](../cli.md#编辑器服务)
- 任务版本核对与计算进程：[编辑器计算](../architecture.md#编辑器计算)
