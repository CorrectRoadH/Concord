# 多来源反馈

先用 `concord feedback connection list --json` 和 `concord feedback list --json` 了解连接与本地观察。Feedback 是产品称呼，受管 Markdown 仍是 `docs/issues/<id>.md` 的 `kind: issue`，不能新建第二份关系索引。

Local、GitHub、Linear 是并列来源。Local 无需账号、连接或同步：用 `concord issue create <id> --title <title>` 创建，`issue index --json` 获取派生索引，`issue recall "查询词" --json` 读取实际正文和摘要。原有 issue draft、feedback create、list/show 仍可用。不要直接读写 Issue owner 或维护人工索引。

正文修改使用 `issue edit <id> --body <file> --expected-digest <digest>`；关联使用 issue link / feedback link。删除使用 `issue remove <id> --expected-digest <digest>`，仅允许无来源、无关系、无历史的本地 draft。已进入调查、关闭或导入的记录保留生命周期，不能通过删除绕过证据；本地命令不删除 GitHub/Linear 对象。

## 建立连接并读取

```sh
concord feedback connection add --id github-main --provider github --owner OWNER --repo REPO --credential-env GITHUB_TOKEN
concord feedback connection add --id github-cli --provider github --owner OWNER --repo REPO --transport gh
concord feedback connection check github-cli --json
concord feedback connection add --id linear-main --provider linear --team TEAM --credential-env LINEAR_API_KEY
concord feedback import https://github.com/OWNER/REPO/issues/123 --connection github-main --json
concord feedback sync --connection linear-main --json
```

API 连接只存凭据环境变量名，省略 transport 仍为 API。GitHub 可明确选择 `--transport gh` 复用 CLI 或 `view` 服务所在机器已登录的 gh；该模式禁止 credential-env，不导出 token。Linear 使用个人 API key，不提供 Linear CLI 模式。凭据值不能写入文档、命令交接或浏览器配置。创建连接只保存选择范围；首次成功导入/同步原子保存远端范围 ID，此后不匹配应调查配置变化。

`feedback connection check <id>` 只检测 gh 连接的指定仓库，不导入、不持久绑定、不枚举账号。检测和同步都是明确的外部读取，不能仅为验证 UI 或配置保存而调用真实账号。工具缺失、未登录、无目标权限或协议错误不能通过自动切换 transport 绕过。gh 模式委托 CLI 处理认证和网络；Concord 保证固定初始只读请求、进程清理、输出预算和返回身份，不能声称控制 gh 内部重定向或网络缓冲。

读取显式触发，不依赖网页刷新。分页只承诺本次有界遍历完成，不代表某时刻的完整远端快照。遇到鉴权、限流、分页不完整或配置冲突时处理具名失败，不把部分结果当作成功，不据缺席推断删除。

## 调查与关联

```sh
concord feedback show <id> --json
concord feedback create observation --title "调查观察"
concord feedback link <id> --feature docs/feature/example/README.md
concord issue link <id> --memory memory/example.md
concord feedback close <id> --reason "调查结论"
```

本地标题、正文与关联是作者事实；source 是首次导入摘录，缓存 remote 是可重建观察。重复同步不覆盖笔记。关闭反馈仍受 open Problem 门禁；远端 Closed / Done 不证明本地修复，Memory fixed 继续要求正常证据流程。

同一外部对象换连接或清空缓存后仍是同一反馈。不要按标题自动合并，也不要用远端显示编号作为对象身份。`cache clear` 只删投影，保留来源和笔记。需要修订正文时用现有摘要保护的 `author set`，或在 Web 反馈详情中编辑 Markdown。
