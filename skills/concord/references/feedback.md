# 多来源反馈

先用 `concord feedback connection list --json` 和 `concord feedback list --json` 了解连接与本地观察。Feedback 是产品称呼，受管 Markdown 仍是 `docs/issues/<id>.md` 的 `kind: issue`，不能新建第二份关系索引。

## 建立连接并读取

```sh
concord feedback connection add --id github-main --provider github --owner OWNER --repo REPO --credential-env GITHUB_TOKEN
concord feedback connection add --id linear-main --provider linear --team TEAM --credential-env LINEAR_API_KEY
concord feedback import https://github.com/OWNER/REPO/issues/123 --connection github-main --json
concord feedback sync --connection linear-main --json
```

配置只存环境变量名。GitHub 使用 token；Linear 首版使用个人 API key。凭据由 CLI 或 `view` 服务进程的环境提供，不能把值写入文档、命令交接或浏览器配置。创建连接只保存选择范围；首次成功导入/同步原子保存远端范围 ID，此后不匹配应调查配置变化。

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
