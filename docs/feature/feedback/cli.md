# CLI 与 Web 用法

连接只保存环境变量名称。先在启动 Concord 的环境中设置所需凭据；GitHub 使用 token，Linear 使用个人 API key。

```sh
concord feedback connection add --id product-github --provider github \
  --owner example --repo product --credential-env GITHUB_TOKEN
concord feedback connection add --id product-linear --provider linear \
  --team TEAM --credential-env LINEAR_API_KEY
concord feedback connection list --json
concord feedback import https://github.com/example/product/issues/123 --connection product-github
concord feedback sync --connection product-linear
concord feedback list --json
concord feedback show <id> --json
concord feedback create local-observation --title "调查观察"
concord feedback link <id> --feature docs/feature/example/README.md
concord issue link <id> --memory memory/example.md
concord feedback close <id> --reason "调查结论"
concord feedback connection remove product-github
```

`feedback sync` 明确读取一个连接的当前范围；`feedback import` 只导入连接范围内指定 URL。首次成功读取会绑定范围 ID。`--dry-run` 检查规划但不写文档和缓存；读取远端本身仍需要凭据与网络。

Web 从侧栏「反馈」进入：按来源或本地处理状态筛选，创建本地反馈，选择连接导入 URL 或同步，进入详情编辑本地 Markdown、关联 Feature / Memory 和关闭。连接表单保存名称与范围，用同一份配置摘要保护外部并发修改。正常工作台刷新只读取本地数据。

缓存不可用时查看首次来源摘录，显式同步重新观察。远端状态和本地结论分别显示；同步不会替你关闭问题，也不会修改 GitHub 或 Linear。
