# 无外部服务时管理本地 Issue

## 用户目标

维护者想把一个缺陷、请求或观察记下来，处理时把调查结论关联上，处理完就让它从仓库里消失，不需要任何外部服务。

## 起始状态

- 项目已初始化，没有配置任何 GitHub 或 Linear 连接。

## 完整路径

1. 记下问题。 {#create}

   ```sh
   concord new issue output-confusion
   ```

   这会创建 `docs/issues/output-confusion.md`，也可以直接创建这个文件。正文写清看到了什么、期望是什么、怎样复现。

2. 找到要处理的问题。 {#find}

   ```sh
   concord list issue
   concord issue search "输出 混乱"
   ```

   `list issue` 列出全部 Issue 的摘要；`issue search` 按关键词匹配标题和正文，返回原文与摘要。`feedback list` 把本地 Issue 与 GitHub、Linear 的反馈放在同一个列表里，接受 `--provider local|github|linear`、`--triage pending|linked` 与 `--query` 筛选，筛选不访问网络。

3. 把调查结论关联上。 {#link}

   ```sh
   concord issue link output-confusion --role investigation memory/output-investigation.md
   ```

   角色见 [Issue 字段](../architecture.md#issue-字段)，省略 `--role` 时为 investigation。`issue unlink` 删除一项关联。

4. 处理完，关闭它。 {#close}

   ```sh
   concord issue close output-confusion --reason "帮助文本改为按任务分组"
   ```

   预期输出：

   ```text
   Closed docs/issues/output-confusion.md
   Reason: 帮助文本改为按任务分组

   Put the lines above in your commit message.
   ```

   `issue close` 删除 Issue 文件，并输出一段可以直接写进提交说明的结论。以后要查这个问题，从 Git 历史找。

## 结果

`docs/issues/` 里只剩还要处理的问题。处理过程与结论在 Git 历史与提交说明里，Concord 不另存关闭记录。

| 情形 | 结果 |
| --- | --- |
| 缺陷修好了 | agent 按[项目验证流程](../../local-sdlc/use-case/validate-change-with-project-tools.md)确认结果，再用普通 `issue close --reason` 删除；关闭不执行测试 |
| 还有页面或其它 Issue 链接这个 Issue | 拒绝关闭，返回 `IssueReferenced` 并列出链接位置；先改写这些链接 |
| 来自 GitHub 或 Linear 的 Issue | 关闭只删除本地笔记，不写远端；远端写入见[远端 Issue 写入](../../neutral-project-governance/use-case/mutate-remote-issue.md) |
| 直接删除 Issue 文件 | 与 `issue close` 效果相同，但没有结论输出；仍有链接指向它时，`check` 报告断开的链接 |

命令写入失败时不改任何文件，返回具名错误并退出 1；`--dry-run` 只预览。
