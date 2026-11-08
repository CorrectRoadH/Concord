# 命令

以下为预期输出。

## 安装与卸载

```sh
concord herdr install
concord herdr uninstall
```

`install` 把随归档提供的 mod 写到 Herdr 的 mods 目录（`$HERDR_APP_HOME/mods/concord`，未设置时为 `~/.config/herdr-app/mods/concord`），已存在时覆盖为当前版本。从源码运行时，`install` 先把 mod 构建到同一个 mods 目录再安装，不需要事先构建归档，worktree 中也不留下产物。`uninstall` 删除这个目录。`--json` 返回 `{"operation":"herdr-install","path":"..."}`。

| 错误 | 什么时候出现 |
| --- | --- |
| `HerdrNotFound` | 没有 `herdr-app` 命令，也没有 Herdr 的配置目录；消息给出安装 Herdr 的命令 |
| `HerdrModPathOccupied` | `mods/concord/` 已存在且不是 Concord 的 mod |
| `HerdrModCheckFailed` | 安装后 `herdr-app check` 失败；`details.output` 是 Herdr 的输出 |

各情形的结果见[用 Concord 命令安装 mod](use-case/install-with-cli.md)。

## mod 调用的命令

mod 只通过公开 CLI 取数据和执行操作，不读取 Concord 的私有状态：

| 用途 | 命令 |
| --- | --- |
| 判断目录是否已初始化、初始化 | `concord --json doctor`、`concord --json init` |
| 文档列表 | `concord --json list` |
| 一页文档及其测试、实现与关系；文档包的全部页面（`pages`） | `concord --json show <path>` |
| 术语 | `concord --json concepts index` |
| 品味与依据位置 | `concord --json taste` |
| 检查 | `concord --json check` |
| 读取一页正文与摘要 | `concord --json action --input-text <JSON>`，执行 `file.get` |
| 渲染一页给 mod 显示 | `concord --json action --input-text <JSON>`，执行 `page.render`，见[渲染一页](#渲染一页) |
| 保存一页文档 | `concord --json action --input-text <JSON>`，执行 `document.set` |
| 等待下一份结果 | `concord --json workspace wait --after <sourceDigest>` |
| 用户点“停止它并继续”时停止另一个安装的工作区服务 | `concord --json server stop` |

除 `page.render` 外，这些命令的输出见各自 Feature 的 cli 页，mod 不另定义字段。

## 渲染一页

`page.render {path, theme}` 是只读的 action：在仓库所在的机器上读一页 Markdown，按出现顺序返回 mod 能直接显示的块。它属于本 Feature，因为只有没有网页引擎的界面需要它；Web 工作台在浏览器里自己渲染。

`theme` 是 mod 当前的 Herdr 主题颜色（`background`、`foreground`、`muted`、`border`、`accent`、`surface` 等颜色名到颜色值）。Concord 按 Web 工作台的[主题变量](../web-workbench/format.md#主题变量)把它们映射成 Mermaid 与 p5 使用的变量。

| 块 | 字段 | 内容 |
| --- | --- | --- |
| `markdown` | `text` | 两个特殊块之间的 Markdown 原文 |
| `image` | `source`、`alt`，以及 `mediaType`、`data`（base64）、`digest` 或 `error` | 仓库内的 PNG、JPEG、GIF、WebP 与 SVG，每张不超过 2 MiB；外链、缺失、越出仓库或超限时只有 `error` |
| `mermaid` | `source`，以及 `svg`、`digest` 或 `error`（带行号） | 用 pele 渲染；SVG 里的 CSS 变量已替换成具体颜色，因为 Herdr 的图片加载器不计算 CSS 变量 |
| `p5` | `source`、`description`，以及 `html` 或 `error` | `description` 取自源码里的 `p.describe` 字面量；`html` 是独立页面，用与 Web 工作台相同的编译、输入检查与[运行环境](../web-workbench/format.md#运行环境)运行这一个图解，带主题变量，不联网 |

整个结果不超过 6 MiB，留在 Herdr `exec` 的 8 MiB 输出上限内；超出时后面的图片改为 `error`，文字块不受影响。页面路径的规则与 `file.get` 相同。
