# Issue 与多来源反馈

Issue 跟踪缺陷、请求与观察，每条是 `docs/issues/<id>.md` 一个文件。Local、GitHub、Linear 是并列来源；Local 无需账号、连接或同步，直接创建文件或运行 `concord new issue <id>`。Feedback 是外部来源的产品称呼，导入结果仍是同一种 Issue 文件，不另建关系索引。

## 字段

路径是身份，名称是正文唯一的一级标题。frontmatter 只保存推导不出的事实，字段只在非空时出现：

```yaml
relations:
  - role: root-cause
    target: memory/token-race.md
source: {...}                    # 导入时写入的远端来源
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause` | Memory | 调查记录与根因 |
| `adopts` | Feature、Use Case 或 Engineering 的路径或锚点 | 该 Issue 当前由这条 Spec 承接；不再承接时删除这一项，历史在 Git |
| `related` | 另一个 Issue | 两个 Issue 相关，例如一个观察的缺陷由另一个 Issue 跟踪 |

`source` 保存远端对象的稳定身份、去重键与首次来源摘录；同一外部对象换连接或清空缓存后仍是同一 Issue。不要按标题自动合并，也不要用远端显示编号作为对象身份。

## 编辑与关闭

直接编辑 Issue 文件的正文与关系。处理完运行 `concord issue close <id> --reason <text>`：命令删除 Issue，输出一段写进提交说明的结论；缺陷修好时用 `--fixed`，先核验再删除。仍有页面或其它 Issue 链接它时拒绝。用 `concord list issue --json` 列出 Issue，`concord show <id> --json` 读取它及派生关系。

## 修复缺陷

修复按线性路径进行：

1. 在 Issue 中写观察、期望行为与复现；调查与根因写进 Memory，用 `relations` 关联。
2. 写一个在当前代码上失败的回归测试，标记 `@issue docs/issues/<id>.md` 与它验证的 Spec，单独提交。
3. 只修改产品文件，提交修复。测试文件、runner 配置、`runner.sourceFiles` 与测试指向的 Spec 在两次提交之间保持不变。
4. 工作树干净时运行 `concord issue close <id> --fixed`。

```sh
concord issue close expired-token-accepted --fixed --json
concord issue close expired-token-accepted --fixed --defect <commit> --json
concord test verify expired-token-accepted --json
```

缺陷候选默认是 HEAD 的 first-parent 历史中最早出现这些回归测试的提交，所有回归测试必须在同一提交中首次出现，否则用 `--defect` 指定 HEAD 的 first-parent 祖先。命令在临时 worktree 中运行缺陷候选、在当前工作树运行 HEAD：前者以非零码结束、后者以零结束才写入 `verification`，内容是两个提交、回归测试、runner 配置摘要与 Concord 版本。

同一提交同时加入测试与修复、缺少测试或提交（包括 shallow clone）、区间含 merge 提交、超时，都返回 `FixUnverifiable`；command runner 不区分断言失败与构建失败。`test verify` 在两个提交上重放已记录的结论，提交、依赖或运行环境不可获得时报告无法重放，不改变结论。

远端 Closed / Done 不证明本地修复；fixed 始终经过这条核验。

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

读取显式触发，不依赖网页刷新。分页只承诺本次有界遍历完成，不代表某时刻的完整远端快照。遇到鉴权、限流、分页不完整或配置冲突时处理具名失败，不把部分结果当作成功，不据缺席推断删除。本地标题、正文与关系是作者事实；缓存的远端状态是可重建观察，重复同步不覆盖本地内容，`cache clear` 只删投影。`feedback list` 与 `feedback show` 是本地读取，不触发同步。

## 远端 Issue 写入

远端写入仅支持已绑定 `repositoryId` 的 GitHub `gh` 连接，复用当前机器的 `gh auth login` 登录态，不改本地 Issue 文件。

1. 先只读计划：`concord issue remote preview close 12 --connection product-gh --reason completed --json`。create、body-set、comment-add 用 `--body <file|->`，labels-add 用可重复的 `--label`，labels-remove 每个计划只接受一个 `--label`；reopen 只需编号和连接。
2. 把 plan 返回的 `authorize` 串（绑定动作、仓库、编号及 payload）交给用户确认。Agent 只有在用户就该授权串或其中的动作、目标与 payload 明确同意后才能传 `--authorize`；不得因 plan 成功、工具可用或权限宽松推断授权。
3. 得到当次明确同意后执行：`concord issue remote apply <plan-id> --connection product-gh --authorize '<plan 返回的原串>' --json`。

计划有效期为五分钟、只能消费一次；前像变化会拒绝写入。`IssueMutationUncertain` 不自动重试：必须重新 plan，manual create 与评论先人工核对远端。多个标签的移除分别 plan、确认并 execute。
