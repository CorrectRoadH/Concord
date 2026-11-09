# 在远程机器的终端旁使用

## 用户目标

维护者在 Herdr 里用一个远程机器的 space 监督 agent，仓库在那台机器上，想在旁边读这个仓库的 Spec。

## 起始状态

- Herdr 已连上机器 `vps`，当前 tab 里的终端位于 `vps` 上的 `~/code/shop`，仓库已初始化。
- `vps` 上安装了 Concord；本机可以没有。

## 完整路径

1. 在这个终端旁打开 Concord mod。 {#open}

   mod 在 `vps` 上检测 `concord` 并运行查询，顶栏显示仓库地址 `vps:~/code/shop`。文档列表、正文、测试与实现与在 `vps` 上运行 `concord show` 的结果一致。

   即使这个仓库还没有运行中的工作区服务，也能直接读到文档；不要求先在终端运行 Concord。远程命令结束不终止服务。切换 tab 或关闭面板后，服务继续按自己的空闲期限退出，不留下已结束的托管终端。

   随后在这个仓库的终端直接运行 `concord --json workspace projection`，复用 mod 已启动的同一个服务，不创建第二个后台。反过来，终端已启动服务时 mod 直接复用；服务身份由项目目录和协议决定，与启动入口无关。

2. agent 在 `vps` 上改了一页文档。 {#follow}

   mod 在 2 秒内刷新，当前打开的文档与滚动位置保持不变。

3. 编辑这页文档并保存。 {#edit}

   与本机相同：mod 把草稿写回 `vps` 上的文件，再在 `vps` 上运行检查，显示 `check: ok` 或问题列表。

## 结果

远程仓库在 mod 里的阅读、编辑、检查与自动刷新都与本机相同，只是命令在 `vps` 上运行。

| 情形 | 结果 |
| --- | --- |
| `vps` 上没有 `concord` | 显示“vps 上没有 Concord 命令行工具”和写明 `vps` 的交给 agent 的安装请求；装好后自动继续，本机有没有 Concord 不影响结果 |
| `vps` 上的 Concord 不认识 mod 用到的命令或选项 | 显示它不认识的命令或选项与写明 `vps` 的交给 agent 的升级请求 |
| 连不上 `vps` | 显示“连不上 vps”与“Herdr 恢复连接后自动重试”；恢复后自动继续，不需要重新打开 |
| 工作区服务不存在或已退出 | mod 通过远程 Herdr core 托管新的前台服务，再等待结果；并发面板复用同一个仓库服务 |
| 首次读取连续两轮等待后仍没有可读投影 | 结束读取提示，显示 `WorkspaceProjectionPending` 的错误与“复制给 agent”，不无限重试 |
| Herdr 无法创建服务终端 | 显示 `HerdrServiceStartFailed` 与原始输出，不把终端创建成功当作服务已就绪 |
| 初始化、保存与检查 | 与本机相同，命令在 `vps` 上运行 |
| 保存前 `vps` 上的文件已被 agent 改过 | 与本机相同，用最新摘要保存；后台通知到达时直接重载，见[修改一页文档并检查](edit-and-check.md) |
| 终端在 `vps` 上 `cd` 到另一个仓库 | mod 跟着切换，与本机相同 |

## Spec 来源

[在 Herdr 里使用 Concord](../README.md)；读写与刷新的实现见[实现](../architecture.md#数据)。
