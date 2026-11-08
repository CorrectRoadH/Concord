# CLI 与客户端接口

本页命令、字段及输出均为 Roadmap 的预期接口。已有项目命令继续表达各自领域操作，新增的后台和票据接口统一它们的执行与观察方式。

## 连接模式

```text
concord [--root <目录>] [--server shared|command] <项目命令>
concord server start|run|status|stop
```

`shared` 是默认模式，连接或自动启动选定项目目录的后台。`command` 启动[命令作用域后台](concepts.md#command-service)，已有实例时失败；本次命令取得结果并确认资源清理后才退出。

`server status` 和 `server stop` 不自动启动后台。安装或协议不同的活跃实例由启动者停止后替换。配置无效或存在 journal 时，诊断、定向原文读取与恢复仍可到达。

`--dry-run` 通过同一后台规划，不发布来源、证据，不执行 runner，也不使用本次操作的持久缓存。它允许服务控制状态变化。`--help`、`--version`、`--skill`、随包资源读取与 `herdr install` 不启动后台。

命令作用域只接受所属命令及同根受管子调用，不允许 `view` 或开启 HTTP 监听。跨根、失效或失联的作用域不自动退回共享模式。

## 执行与观察

```text
concord test run <测试 ID> [--background]
concord operation list [--json]
concord operation show <票据> [--json]
concord operation wait <票据> [--json]
concord operation cancel <票据> [--json]
```

有副作用的命令自动完成准备、输入上传与提交，默认等待结果。`test run --background` 在提交受理后返回票据；命令作用域拒绝这个选项，避免命令退出立即取消刚提交的任务。

票据在 JSON 中为 `{instance, operationId}`，命令参数使用 `<instance>:<operationId>`。实例和操作 ID 都是后台签发的不含冒号的标识，客户端不能自行生成一个 ID 来开始执行。

操作响应结构为：

```ts
type Operation = {
  ticket: { instance: string; operationId: string };
  name: string;
  state: 'prepared' | 'queued' | 'running' | 'cancelling'
    | 'succeeded' | 'failed' | 'cancelled' | 'unknown' | 'cleanup-failed';
  createdAt: string;
  finishedAt?: string;
  result?: unknown; // 对应应用操作的严格结果 Schema
  error?: { code: string; message: string; details?: unknown };
  exitCode?: number;
};
```

`list` 返回 `{instance, operations}`，只包含票据、操作名、状态与时间；`show` 和 `wait` 可以附带完整结果。输入、凭据与执行环境不进入这些响应。

`succeeded` 只表示应用调用完成；测试是否通过、检查是否存在 finding 由领域结果判断。CLI 等待终态后沿用该领域结果的退出码；取消为 130，结果未知或清理失败为 1。查询一个失败操作的状态本身可以成功返回。

`cancel` 对准备状态立即释放输入，对排队状态停止派发，对运行状态提出取消请求。返回 `cancelling` 不证明进程已经退出；写入提交可能最终成功，取消不是回滚。

Ctrl-C 请求取消并等待确认；再次强制退出会结束等待，但不能声称后台操作已取消。普通断线、关闭浏览器或关闭 stdout 不发取消请求。

## 有界 CLI 桥接

Herdr 等只有一次性执行能力的宿主使用下列接口，不需要直接写项目文件。

```text
concord operation prepare <操作名> --bytes <字节数> --sha256 <摘要> --json
concord operation input <票据> --offset <偏移> --base64 <数据> --json
concord operation submit <票据> --json
concord workspace read <项目相对路径> [--if-unchanged <摘要>] --json
concord workspace changes [--after <cursor>] [--wait <秒>] --json
```

prepare 只接受应用白名单中的操作名；它预留容量并冻结执行上下文，不执行领域操作。input 接收严格 JSON 输入的 UTF-8 字节，submit 在全部输入解码成功后派发一次。同一票据重复 submit 只返回原操作。

单块最多 32 KiB 解码字节，整次输入最多 32 MiB；偏移必须等于下一位置，或完整重复一个已接受的块。重复块内容不同时拒绝，输入缺失或总摘要不符时禁止提交。input 响应为 `{ticket, nextOffset}`。

准备连续 60 秒没有有效上传进展或总时长达到 30 分钟时过期。过期发生在提交前，领域操作尚未执行，界面保留草稿；重复上传旧块不延长期限。

read 返回定向读取的字节、摘要及当前读取信封，遵守现有文件安全与大小限制。changes 返回 `{cursor, state}`，cursor 对应实例和递增修订号；state 包括来源身份、刷新状态与操作摘要，不含正文或执行环境。

changes 默认最多等待十五秒；没有变化时返回原 cursor。整个桥接请求三十秒超时。省略 cursor、实例变化或 cursor 无效时返回完整状态；客户端随后读取所需快照，不逐条重放事件。

## 断线与记录保留

只读查询断线后允许重做一次，领域失败不自动重试。写入和测试一旦发送 submit，就只能查询或再次提交同一票据，不能因为响应丢失重新 prepare。

终态结果最多保存十分钟；容量不足时可以更早淘汰。服务重启、票据过期且已删除、或记录淘汰后，结果明确未知，不能据此推断没有执行。只有客户端确定尚未发送 submit 时，才可以安全重新准备输入。

后台不承诺跨重启继续执行任务。来源文件、测试证据、journal 与 runner 状态继续由各自 Spec 拥有；缓存、相同文件内容或操作列表都不能代替恢复裁决。

## 具名失败

CLI 请求失败沿用 `{error, message, details?}` 的错误信封，非零退出。操作已经受理时，其领域失败保留在操作记录中。

| 失败 | 含义与后续动作 |
| --- | --- |
| `WorkspaceServerUnavailable` | 无法在启动预算内得到可用服务；报告启动诊断，不在客户端执行项目操作 |
| `WorkspaceServerBusy` | 所需资源或项目所有权被占用；未受理新操作 |
| `WorkspaceServerScoped` | 外部连接、HTTP 或后台运行选项不符合命令作用域 |
| `WorkspaceServerScopeMismatch` | 继承作用域与目标根不符或标识无效；不重定向到其它根 |
| `WorkspaceServerScopeExpired` | 所属实例或所有者已结束，不能启动游离后台 |
| `OperationInputInvalid` | 长度、偏移、摘要、UTF-8 或操作 Schema 无效；尚未派发 |
| `OperationExpired` | 仍可识别的准备记录已超期，尚未派发；记录已删除时使用结果未知 |
| `OperationOutcomeUnknown` | 票据或执行结果无法确认；检查来源与恢复材料，不自动重跑 |
| `JobBusy` | 同一项目的测试运行槽被占用 |
| `CleanupFailed` | 受管进程清理未确认，保留阻断和诊断 |

已有来源、配置、发布与恢复失败保持原语义。共享后台不能把领域失败转换成另一条执行路径上的成功。
