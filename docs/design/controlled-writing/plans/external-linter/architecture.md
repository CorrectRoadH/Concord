# 内置门禁与显式外部建议

## Entity Ownership

门禁完全引用[政策规则架构](../policy-rules/architecture.md)，不复制 Schema、词表或抽取逻辑。没有政策 `linter` 字段，外部建议不取得写入政策或更改 finding 的权限。

显式建议入口为 `concord writing suggest --request <file> --json`。request 是单次执行输入，不是被自动发现的 owner，严格解码下列形状，不把它当政策配置：

```ts
type SuggestionRequest = {
  format: 'concord.writing-suggestion-request/v1';
  argv: readonly [string, ...string[]];
  files: readonly [string, ...string[]];
  output: 'jsonl-v1';
  timeoutMs: number; // 1..60000，安全整数
};
type Suggestion = {
  file: string; line: number; message: string;
  rule?: string; replacement?: string;
};
```

argv 元素非空，shell=false；files 必须是安全仓库相对的已有 Markdown 路径，不允许 symlink 逃逸。`{files}` 必须恰好是一个完整 argv 元素，展开为多个文件参数，不做字符串插值。相对可执行文件同样限制在仓库内；PATH 程序由用户信任并显式选择。

该能力仅适配本地、只读建议工具；外部发送文档、付费服务、生产动作和写回仍须另行授权。Concord 不自动下载工具、不自动安装词表，也不宣称沙箱可阻止任意命令产生副作用。

## Data Flow

1. 显式命令取得 request 与选中文件快照，记录输入摘要；静态入口从不执行此流程。启动任何建议子进程前取得既有 runner 的 run lease 和失效状态，捕获输入后关闭来源快照。所有权贯穿执行、解析和终结；与其它占用同一 runner 的执行互斥，不创建第二套协调目录。
2. 以仓库 root 为 cwd，由 Effect Scope 管理子进程和进程组。stdin 关闭；timeout 上限 60 秒，取消、超时与退出后均执行 TERM、grace、KILL 和存活核验。
3. stdout 按 UTF-8 JSONL 严格解码，每行一条 Suggestion；只接受 files 中的路径、正整数行号及非空消息。stdout/stderr 总计上限 1 MiB，建议上限 1000 条。
4. 进程资源终结后核对文件前后摘要。输出工具 argv、来源摘要、观察时间、建议及完整性；报告只返回给调用者，不落为政策 owner，也不进入当前门禁。

## Invariants

建议报告与写作 finding 分开。报告 schema 为 `concord.writing-suggestions/v1`，包含 `suggestions`、`inputs`、`observedAt`、`current`、`complete`、`gaps`、`cleanup`。历史、不完整或清理未知均明确标记，不能解释为 check 通过。

输出具有观察性质，沿用[共同观察结构](../../../test-journey-steps/共同身份.md#观察结果)的摘要、时间、当前性与缺口语义；不伪装为原生清单、LSP 分析或相关性结论。它不写入共享 Observation 缓存，不扩大共同契约规定的观察生产命令集合。

建议失败、缺失、配置变化、缓存删除均不改变内置门禁结果。建议进程不持文档 publication lease，不改写文件、不创建独立生命周期 owner。清理完成后，在新的受校验快照中核验输入与 run 失效状态，再完成并释放本 run。清理未知、父进程死亡或终结协调失败时，按既有 runner 协议保留 token 绑定的隔离状态，阻断后续发布。本次命令非零退出；建议结果不改变内置门禁的领域结论。

## Errors

| code | 结果 |
| --- | --- |
| `InvalidWritingSuggestionRequest` | 严格 Schema、路径、argv 占位或预算不合法，不启动进程 |
| `WritingSuggestionFailed` | 启动失败、非零退出、解析失败、超时、输出超限、文件变化或清理未知；保留具名 gaps |

失败报告的 complete 为 false，清理仍执行；不将 stderr 或未解码片段作为成功建议。建议命令退出码不等于 `check` 退出码，也不能替代它。

## Identity and Reuse

输入摘要覆盖 request、文档字节、协议实现与工具可辨识身份。PATH 工具无法稳定识别版本时附 `ToolIdentityUnknown` 缺口，不复用旧建议；Concord 不保证外部可执行文件依赖闭包完整。

v3 与 legacy 迁移完全引用内置架构。建议请求是独立版本化的单次输入，不借新入口迁移旧 journal 或降低 CAS 要求。

## 性能与验收

内置门禁遵守同一[性能预算](../policy-rules/architecture.md#性能预算)。建议入口有 60 秒进程上限与输出上限；外部工具耗时单独记录，不成为高频静态门禁预算的借口。

隔离消费者用真实子进程 fixture 验证显式启动、非法 JSONL、输出上限、取消、超时及后代清理；fixture 只模拟外部工具。相同文档先后运行建议成功、失败和缺失工具，再检查内置结果与摘要均不受建议影响。
