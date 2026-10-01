# 共同验收场景

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | 他人未提交的测试文件写错 `@feature` | 一个 suite 文件写 `@feature docs/feature/x/library.md`，其余文件合法 | feature/test list 与 show 返回其余结果、`complete: false` 与带路径 finding，文案说明需要 Feature package README 或 `@use-case` 并给出 `docs/feature/x/README.md`；check 报告全部 finding 后退出 1；Memory fixed 解决与 case 关系写入零写入拒绝；memory create 与本地 Issue 写入照常完成 |
| C2 | 授权后创建远端 Issue | 已绑定仓库 ID 的 gh 连接、完整 open/closed 列表、带 origin-key 的正文 | plan 只读并输出 receipt 与授权串；无授权串或授权串的 payload 部分不符时 execute 零写入；带一致授权串的 execute 恰好一次写入 |
| C3 | 计划后远端变化或重复执行 | plan 后目标 Issue 标题改变；同一 receipt 执行两次；receipt 过期；写请求超时 | 前三项分别返回 Drifted、Consumed、Expired，均无写调用；超时返回 Uncertain，重新 plan 已生效的 close 返回 NoChange |
| C4 | 关闭本地 Issue | 无 `concord.repository.json` 的仓库；一份 draft Issue 关联已 fixed 的 Problem，另一份关联 open Problem | 只有一个命令组能关闭；关联 open Problem 的关闭被拒绝；带旧参数的退役入口返回具名错误指向替代命令；Issue 文件格式与 check 判定不变 |
| C5 | 共享 main 上切分文档 | scope 外有他人未提交文件；scope 内干净 | prepare 成功；scope 或读集合内有脏文件时零写入并列出路径与 item |
| C6 | 依赖与检查 | A 写入 B 读取的文件且未声明依赖；声明环；配置的检查命令失败；B verified 后 A 重新 verified | 前两项 prepare 聚合拒绝；检查失败的 receipt 标记 failed，finalize 拒绝；A 重新 verified 后 finalize 要求 B 重新 verified |
| C7 | 宿主组合命令树 | 宿主挂载 Concord 贡献并输入未知子命令，带与不带 `--json` | help 与 Concord 自带入口一致；未知子命令只输出一条 `UnknownSubcommand` 错误并退出 1，带 `--json` 时为一行 JSON 错误 |
