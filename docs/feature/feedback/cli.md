# CLI 与 Web 用法

连接保存来源范围和读取方式，不保存密钥值。GitHub 可选择复用运行 Concord 的机器上已登录的 `gh`，或使用环境变量提供 token；Linear 使用个人 API key。省略读取方式时使用 API 模式。

```sh
concord feedback connection add --id product-github --provider github \
  --owner example --repo product --credential-env GITHUB_TOKEN
concord feedback connection add --id product-gh --provider github \
  --owner example --repo product --transport gh
concord feedback connection check product-gh --json
concord feedback connection add --id product-linear --provider linear \
  --team TEAM --credential-env LINEAR_API_KEY
concord feedback connection list --json
concord feedback import https://github.com/example/product/issues/123 --connection product-github
concord feedback sync --connection product-linear
concord feedback list --json
concord feedback show <id> --json
concord new issue local-observation
concord issue link <id> --role adopts docs/feature/example/README.md
concord issue link <id> --role investigation memory/example.md
concord issue close <id> --reason "调查结论"
concord feedback connection remove product-github
```

`feedback sync` 明确读取一个连接的当前范围；`feedback import` 只导入连接范围内指定 URL。首次完整同步成功时绑定范围 ID。`--dry-run` 检查规划但不写文档和缓存；读取远端本身仍需要凭据与网络。

`--transport gh` 不接受 `--credential-env`；Concord 不导出 CLI 的 token。先在运行 Concord 的机器上完成 `gh auth login`，再保存项目连接。`feedback connection check <id>` 只检测 gh 连接的指定仓库访问与既有绑定，不导入反馈、不提前绑定、不保存账号列表。缺失工具、未登录或无访问权限分别报告，不自动退回 API。

gh 模式要求 GitHub CLI 2.98.0 或更新的兼容版本，以及支持进程组回收的 POSIX 环境；不自动安装工具。Windows 上继续使用 API 模式或本地反馈。CLI 默认认证优先级为 GH_TOKEN、GITHUB_TOKEN、已保存的 gh 凭据，均来自启动 Concord 的环境。

Web 从侧栏「反馈」进入：按来源或本地处理状态筛选，创建本地反馈，选择连接导入 URL 或同步，进入详情编辑本地 Markdown、按角色关联 Memory 与承接的 Spec，以及关闭。在「项目设置 → 反馈来源」维护连接，表单保存名称与范围，用同一份配置摘要保护外部并发修改。正常工作台刷新只读取本地数据。

GitHub 连接的读取方式可在项目设置中明确切换；切换保留仓库绑定和已导入对象身份。gh 模式不显示凭据变量输入，API 模式要求变量名。「检测连接」先保存当前设置，保存冲突时保留草稿并停止检测；检测结果只属于本次运行，不写回配置。普通刷新和保存设置不会检测账号或访问远端。

## 读取方式与保证

两种读取方式的保证不同：

| 方式 | Concord 保证 |
| --- | --- |
| API（省略 `--transport` 或 `--transport api`） | 要求 `--credential-env`；拒绝 HTTP 重定向并限制网络响应读取 |
| gh（`--transport gh`） | 禁止 `--credential-env`；认证、HTTP/TLS、内部重定向和网络缓冲委托给 gh。Concord 只保证固定的只读请求、输出与时间上限、身份核验和零部分发布 |

两种方式不自动互相回退。gh 模式使用服务端登录态：能操作工作台的人可以触发该账号对配置仓库的读取，选择 gh 不构成浏览器用户的身份认证；界面写明账号来自运行 Concord 的机器。

gh 模式只发出只读请求，不执行远端写入、安装、登录或 token 导出。状态区分工具缺失、未登录、无目标权限、协议不兼容和读取失败，不把这些状态当成空反馈集合。不支持进程组回收的平台返回具名能力缺失，本地反馈与 API 模式仍可用。适配实现见 [gh 读取适配](architecture.md#gh-读取适配)。

缓存不可用时查看首次来源摘录，显式同步重新观察。远端状态和本地结论分别显示；同步不会替你关闭问题，也不会修改 GitHub 或 Linear。


## 没有远端连接的本地工作流

```sh
concord new issue output-confusion
concord feedback list --provider local --triage pending --json
concord show docs/issues/output-confusion.md --json
# 直接编辑 docs/issues/output-confusion.md 的正文
concord issue link output-confusion --role investigation memory/output-investigation.md
concord check
```

Issue 文件可以直接编辑与删除；删除后 `check` 报告指向它的失效引用。本地写入从不自动写入 GitHub 或 Linear。

## 命令分工

`concord issue` 是执行必要步骤的本地 Issue 助手：`close`（删除 Issue，fixed 时先核验）、`link`、`unlink`，见[本地 Issue](use-case/manage-local-observations.md)。远端写入只经 [remote preview 与 remote apply](../neutral-project-governance/use-case/mutate-remote-issue.md)。`concord feedback` 只负责外部来源与反馈列表：`connection`、`sync`、`import <url>`、`list`、`show`。help 描述本地 owner 时统一使用 Issue 一词。action 提供 `issue.close`、`issue.link` 与 `issue.unlink`，参数与 CLI 相同。

全部 Issue 文件可以直接编辑，命令写入同样的内容，`check` 检查字段是否完整。
