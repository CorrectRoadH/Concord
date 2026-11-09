# 把安装、升级与命令报错交给 agent 处理

## 用户目标

维护者在 Herdr 中打开 Concord mod 时，如果当前机器还没装 Concord、版本过旧，或运行中遇到配置损坏等命令报错，不必自己去终端敲命令排障，直接把 mod 生成的请求复制给旁边的 agent 处理（[要人处理的事，交给 agent](../../../taste.md#t-15)）。

## 起始状态

- Herdr 中已打开终端与 Concord mod。

## 完整路径

1. 遇到未安装或版本过旧时，在状态页复制请求。 {#copy-setup-request}

   终端所在机器没有安装 Concord，或已安装的 Concord 不认识 mod 用到的命令时，mod 不显示文档列表，而是显示[状态页](../ui.md#状态页)与一段等宽字体的请求（以下为预期输出）：

   ```text
   在 vps 上安装 Concord 命令行工具：运行
   curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh
   然后用 concord --version 确认能运行。
   ```

   点击旁边的主按钮“复制给 agent”，按钮短暂变成“已复制”，再把剪贴板里的请求贴给终端里的 agent。

2. agent 安装或升级完成后，mod 自动继续。 {#auto-resume}

   状态页停留期间，mod 每 2 秒在目标机器上重新检测一次。agent 安装或升级好 Concord 后，mod 自动读取仓库并切换到文档列表，不需要手动刷新或重新打开面板。

3. 阅读或编辑时遇到命令报错，从错误横幅复制排障请求。 {#copy-error-banner}

   已经显示文档时，若后台命令返回具名错误（例如 `ConfigurationInvalid`），顶栏下方出现一条 `blocked` 色的错误横幅，正文与文档列表保持原样（[出错时](../ui.md#出错时)）。点击横幅右侧的“复制给 agent”（以下为预期输出）：

   ```text
   Concord 在 ~/code/shop 报错：ConfigurationInvalid：配置需要修正。
   请找出原因并修好；修好后 Concord mod 会自动恢复。

   复制时附上原始输出（12 行）
   ```

   界面上只显示“复制时附上原始输出（12 行）”，复制进剪贴板的内容在末尾附上完整原始输出供 agent 诊断。

4. agent 修复问题后，横幅自动消失。 {#clear-after-fix}

   agent 根据原始输出修好文件或完成恢复后，mod 在下一次成功读取时自动收起错误横幅，并刷新当前文档与检查状态。

## 结果

要人介入的环境准备与错误恢复都变成一段可以直接交给 agent 的请求，修好后 mod 自动恢复。

| 情形 | 结果 |
| --- | --- |
| 本机没有安装 Concord | 状态页标题显示“这个 mod 需要 Concord 命令行工具”，给出安装请求与“复制给 agent” |
| 远程机器没有安装 Concord，或版本过旧 | 状态页标题指明远程机器名，请求写明在那台机器上安装或升级 |
| 命令返回具名错误 | 横幅显示具名错误的消息，“复制给 agent”复制机器、目录、错误名与消息、目标结果及原始输出 |
| 命令返回无法识别的失败 | 横幅显示“Concord 命令失败”，“复制给 agent”同样附上原始输出 |
| 仓库还没有初始化（`ProjectNotInitialized`） | 不当作错误横幅，状态页显示“在这里初始化 Concord”主按钮，见[在空仓库里初始化 Concord](init-from-herdr.md) |

## Spec 来源

- [状态页与交给 agent](../ui.md#状态页)
- [要人处理的事，交给 agent](../../../taste.md#t-15)
