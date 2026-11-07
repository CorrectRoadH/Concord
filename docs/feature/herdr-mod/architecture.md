# Concord mod 的实现

Concord mod 是可独立分发、也随归档提供的一组 JavaScript 文件：`main.js` 默认导出一个继承 `View` 的类，`mod.json` 声明 `"place": "right"`。它按 Herdr 的 mod 接口绘制原生界面，不包含 HTML、CSS 或网页视图。

接口依据是 herdr-app 的 [mod 指引](https://raw.githubusercontent.com/herdrdev/herdr-app/refs/heads/master/defaults/AGENTS.md)，以及运行中的 Herdr 每次启动时生成的 `herdr.d.ts` 与 `gpui-kit.d.ts`。本页用到的接口：`View` 的 `init`、`render`、`close`；`focused`、`panes`、`spaces`、`theme`；`exec`、`readTextFile`、`writeTextFile`、`watchFolder`；`TextView.markdown`、`EditorState` 与 `Editor`。真实主机上的验收用 `herdr-app check <mod 目录>` 加载 mod，用 `herdr-app shot` 截图核对界面。

## 数据

- 目录：mod 跟随所在 tab 里最近聚焦的终端 pane，取它的实时 `cwd`（`panes()`），机器取它所在 space 的 `machine`。`cwd` 变化后重新解析仓库根；根没变（只是进了子目录）不重新加载。mod 不提供目录选择器：Herdr 的 `pickFolder` 只能选本机目录，跟随终端已覆盖换仓库的需要。
- 读取：用 `exec('concord', ['--json', ...], { cwd, on })` 调用[mod 调用的命令](cli.md#mod-调用的命令)，用 `readTextFile(path, { on })` 读正文；本机时 `on` 为 null。CLI 检测同样带 `on`，所以检测的是仓库所在机器上的 Concord。mod 不缓存结论，每次刷新重新取。
- 写入：保存时用 `writeTextFile` 写回文件，写入前比较读取时的文件摘要，已被别人改过就提示保存冲突、保留草稿，不覆盖。写入后运行 `concord --json check` 显示结果。`writeTextFile` 只能写本机，所以远程仓库不提供编辑；初始化与新建 Feature 是 CLI 命令，照常在那台机器上运行。
- 刷新：本机用 `watchFolder` 监听仓库目录，变化合并 200ms 后重新取数据；监听被拒绝时每秒重新取。远程机器不能监听，每 2 秒用一条廉价的命令询问那台机器上被监听的目录有没有变化，有变化才重新取数据。两种方式下，当前打开的文档、滚动位置与草稿都保持不变。
- 连接：远程 `exec` 因机器不可达而失败时显示“连不上 <机器>”，保持定时重试，恢复后自动继续。

## 界面

- 顶栏左边是“Concord”和次要色的位置：本机显示以 `~` 缩写的仓库路径，远程显示 `<机器>:<路径>`。右边只有已初始化时的“新建 Feature”。
- 左栏是文档树，按 Feature、品味、术语、Issue、Memory、其它文档分组；右侧是正文。Feature、Engineering 与 Roadmap 的文档包页面取自 `concord --json show <包>` 的 `pages`，按 `path` 组织成树，`kind` 只用于显示，未知取值按普通页面显示。
- “其它文档”只包括项目的固定入口中存在的那些：`docs/README.md`、`docs/architecture.md`、`docs/document-model.md`、`docs/taste.md`、`docs/concepts.md` 与 `docs/writing.md`，以及从已列出页面的正文链接可以到达的 Markdown。mod 不扫描任意 Markdown。
- 正文用 `TextView.markdown` 渲染；编辑用 `EditorState` 与 `Editor`。
- Use Case 正文下方列出守护它的测试与实现它的代码，按步骤分组；点击跳到对应文件位置。
- p5 代码块显示 `p.describe` 的文字说明与源码，以及“在浏览器中播放”按钮：mod 让 Concord 把这一个图解导出为本地 HTML 文件，再用系统浏览器打开。

### 状态页

还不能显示文档时（检测 CLI、缺少或过旧的 CLI、没有终端、不是 Git 仓库、连不上机器、还没有初始化），mod 只显示一张状态页，不显示文档树：

- 内容在面板中部成一列，最宽 360px，左对齐；背景、文字与按钮都取 Herdr 主题的颜色名。
- 第一行是标题，用一句话说出发生了什么，例如“这个仓库还没有初始化 Concord”。
- 第二行用次要色（`muted`）说明在哪里或为什么：仓库路径、机器名或缺少的版本。
- 需要用户运行的命令放在代码块里，可以选中复制；需要 mod 执行的操作是一个主按钮（`solid` / `solid_foreground`），按钮按文字宽度，不拉满整行。一页最多一个主按钮。
- 不显示原始的进程输出或异常文本。CLI 返回命名错误时显示它的消息；无法识别的失败显示“Concord 命令失败”，原始输出折叠在“详情”下。

## 分发构建

`scripts/build-herdr-mod.ts` 负责共享的 mod 打包：固定 Vite+ 编译 TypeScript，保留 Herdr/GPUI 外部导入并捆绑其它依赖；不包含本机路径或 source map。独立入口先在临时目录构建并校验文件，再更新 `concord/`；完整归档复用同一构建函数。安装说明、许可证和真实截图随目录提供。行为见[独立交付](../../engineering/build/use-case/share-herdr-mod.md)。

## 安装

`concord herdr install` 复制归档中的 Concord mod 目录，不修改 Herdr 的其它 mod、布局或快捷键。Concord mod 通过 `herdr-app check` 校验。
