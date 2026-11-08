# Concord mod 的实现

Concord mod 是可独立分发、也随归档提供的一组 JavaScript 文件：`main.js` 默认导出一个继承 `View` 的类，`mod.json` 声明 `"place": "right"`。它按 Herdr 的 mod 接口绘制原生界面，不包含 HTML、CSS 或网页视图。

接口依据是 herdr-app 的 [mod 指引](https://raw.githubusercontent.com/herdrdev/herdr-app/refs/heads/master/defaults/AGENTS.md)，以及运行中的 Herdr 每次启动时生成的 `herdr.d.ts` 与 `gpui-kit.d.ts`。本页用到的接口：`View` 的 `init`、`render`、`close`；`focused`、`panes`、`spaces`、`theme`；`exec`、`settings`；`on_size_change`、`svg`、`image`；`TextView.markdown`、`InputState` 与 `Input`、`EditorState` 与 `Editor`。真实主机上的验收用 `herdr-app check <mod 目录>` 加载 mod，用 `herdr-app shot` 截图核对界面。

## 数据

- 目标 tab：布局侧栏在每次渲染时从 `focused()` 读取当前 tab；没有当前 tab 时显示没有终端。带 `props.pane` 的独立 pane 从 `panes()` 查所属 tab，只跟随这个 tab。切换目标 tab 时停止旧的变化等待，重新解析机器与仓库根；前一目标的异步解析结果不能覆盖当前目标。
- 仓库地址：mod 按 tab 记住最近聚焦的终端 pane，取它的实时 `cwd`（`panes()`）与所在 space 的 `machine`。机器与根目录共同确定仓库；只是进入同一仓库的子目录时保留当前内容。切换 tab 后即使仓库相同也立即刷新，保留选中的文档与草稿；换仓库时重新检测 CLI，清除前一仓库的错误。
- 编辑中换仓库：保留原仓库的草稿，提示保存或放弃后切换。保存仍写入原仓库；等待期间再次切换 tab 时，以最新目标为准。mod 不提供目录选择器，因为 `pickFolder` 只能选本机目录，跟随终端已覆盖换仓库的需要。
- 通路：mod 与 Concord 之间没有常驻连接。每个操作是一次 `exec('concord', ['--json', ...], { cwd, on })`，`on` 是仓库地址的机器（本机为 null）；命令在那台机器上找到仓库根，经本机 socket 使用该仓库的[工作区服务](../local-data-engine/architecture.md#cli-查询)。CLI 检测同样带 `on`。本机与远程是同一条通路，mod 不使用 `readTextFile`、`writeTextFile`、`watchFolder` 或 `pickFolder`：后三个只作用于本机，正文与它的摘要又要来自同一次读取。
- 读取：调用[mod 调用的命令](cli.md#mod-调用的命令)；正文用 `action` 的 `file.get` 读取，同时得到它的 `digest`。mod 不缓存结论，每次刷新重新取。
- 写入：保存时运行 `concord --json action --input-text <JSON>`，执行 `document.set`，`expectedDigest` 取打开这页时 `file.get` 返回的 `digest`，所以文档包的附页与固定入口也能保存。返回 `FileChangedSinceRead` 时按保存冲突处理、保留草稿，不覆盖。写入后运行 `concord --json check` 显示结果。
- 刷新：布局侧栏或所属 tab 在前台的独立 pane 循环运行 `concord --json workspace wait --after <sourceDigest>`，命令返回新结果时重新取数据；当前打开的文档、滚动位置与草稿保持不变。独立 pane 所属 tab 不在前台时不等待，回到前台时立即刷新一次。服务不可用（例如 `HawdbUnavailable`）时改为每 2 秒重新取一次。
- 连接：`exec` 因机器不可达而失败时显示“连不上 <机器>”，每 2 秒重试，恢复后自动继续。

## 界面

mod 的外观与 Herdr 自带的 Files、Changes 一致，看起来是 Herdr 的一部分，而不是一张网页。

### 外观

- 整个面板是一张卡片：`background` 底色、1px `border` 边框、10px 圆角。颜色一律取主题的颜色名，不写死色值，换主题时跟着变。正文 13px，路径与说明 12px，小标题与计数 11px。
- 顶栏高 42px，下面一条 `border` 分隔线。左边是粗体的“Concord”，接着是 `dim` 色、放不下时截断的仓库地址：本机显示以 `~` 缩写的路径，远程显示 `<机器>:<路径>`。右边放当前视图的操作。
- 能点的东西看起来就能点：行高 28px、7px 圆角，悬停时 `hover` 底色并显示手形指针，当前打开的页面用 `selected` 底色。不能点的分组标题是 11px、`dim` 色的小标题，后面跟页数，和可点的行一眼可分。没有页面的分组不显示。
- 按钮高 28px，宽度随文字。主按钮用 `solid` / `solid_foreground`，一屏最多一个；其它按钮是带 `border` 边框的次按钮。正在执行的按钮显示进行中的文字（例如“正在保存…”），执行期间不能再点。
- 图标是随 mod 分发的 Lucide 线条图标（ISC 许可，写入 `NOTICE.txt`），用 `svg()` 按文字颜色着色：展开箭头、文件夹、文档、Use Case、测试、代码、加号、返回与关闭。
- 文件位置（`路径:行`）与代码用 `settings().font_family` 的等宽字体。

### 两种宽度

面板宽度取自 `on_size_change`。布局侧栏常常只有四五百像素宽，两栏挤在一起时文档树和正文都读不下去：

- 窄于 640px：一次只显示一个视图。默认是文档列表；点一页进入页面视图，顶栏左边出现返回箭头，“Concord”换成页面标题。点返回箭头回到列表，列表的滚动位置与展开状态保持不变。
- 640px 及以上：左边是 240px 宽的文档列表，右边是页面，中间一条 `border` 分隔线。还没有打开页面时，右边用 `dim` 色显示“选一页开始阅读”。

### 文档列表

- 分组依次是 Feature、品味、术语、Issue、Memory、其它文档。Feature、Engineering 与 Roadmap 的文档包页面取自 `concord --json show <包>` 的 `pages`，按 `path` 组织成树；`kind` 只决定图标，未知取值按普通页面显示。
- 文档包与种类目录是可折叠的节点：一行显示展开箭头、图标与标题。点箭头只展开或折叠；点标题打开它的 `README.md` 并展开。包内的 `README.md` 不另起一行，包节点本身就是它。默认全部折叠，打开的页面所在的节点自动展开；刷新、换页与切换宽度都不改变展开状态。
- 每一行显示标题，不显示路径；放不下时截断。
- “其它文档”只包括项目的固定入口中存在的那些：`docs/README.md`、`docs/architecture.md`、`docs/document-model.md`、`docs/taste.md`、`docs/concepts.md` 与 `docs/writing.md`，以及从已列出页面的正文链接可以到达的 Markdown。mod 不扫描任意 Markdown。
- 文档列表还没取到时显示 `dim` 色的“正在读取文档…”，不显示空的分组。

### 页面视图

- 顶栏下面是页面的工具行：左边是 `dim` 色、可截断的页面路径；右边是“编辑”。编辑时换成“放弃修改”与主按钮“保存并检查”。
- 正文来自 `page.render`（见[渲染一页](cli.md#渲染一页)），四周留 12px 边距，可滚动：`markdown` 块用 `TextView.markdown`，`image` 与 `mermaid` 块把字节写到 `<appHome>/data/concord/render/<digest>.<扩展名>` 再用 `image()` 显示，因为 `image()` 只读 Herdr 配置目录下的文件。目录只保留当前打开的页面用到的文件，换页与关闭 mod 时删除其它文件。主题变化时重新渲染当前页。
- 编辑时 `Editor` 占满工具行下面的全部高度，编辑的仍是 `file.get` 读到的原文。
- `p5` 块显示文字说明与源码，以及“在浏览器中播放”：mod 把块里的 `html` 写到同一目录，用 `open_url` 以 `file://` 交给系统浏览器。
- 检查结果是工具行下面的一条横幅：通过时是 `done` 色的“检查通过”；有问题时是 `blocked` 色的“N 个问题”，下面每个 finding 一行：等宽的 `路径:行` 与说明，点一行打开那个位置的源码。保存冲突、页面已被删除、终端已切到别的仓库也用同样的横幅，横幅里带它的操作按钮。
- Use Case 正文下方隔一条分隔线，列出“守护它的测试”与“实现它的代码”，按步骤分组，步骤名是小标题。每项一行：图标、名称和 `dim` 色的 `路径:行`；点一项，在正文下方打开那个位置的只读源码，带标题和关闭按钮。
- 点正文里的概念链接，在正文上方显示一张 `raised` 底色的卡片：术语、定义和它所在的 `concepts.md`，右上角是关闭按钮。

### 新建 Feature

已初始化时顶栏右边有“新建 Feature”次按钮（带加号图标）。点它在顶栏下面展开一张表单：“Feature 名称”与“标题”两个带边框的输入框，下面是“取消”和主按钮“创建”；名称为空时“创建”不可用。创建后打开新 Feature 的 README 并进入编辑。再点一次“新建 Feature”或点“取消”收起表单。

### 出错时

- 已经显示文档时出错，在顶栏下方显示一条横幅：`blocked` 色的错误消息，右边是关闭按钮；有原始输出时多一个“详情”，点开以等宽字体显示。错误不混进正文，正文与文档列表保持原样。
- 不显示原始的进程输出或异常文本。CLI 返回命名错误时显示它的消息；无法识别的失败显示“Concord 命令失败”，原始输出折叠在“详情”下。
- 下一次成功读取时横幅自动消失。

### 状态页

还不能显示文档时（检测 CLI、缺少或过旧的 CLI、没有终端、不是 Git 仓库、连不上机器、还没有初始化、仓库被另一个安装的工作区服务占用），mod 只显示一张状态页，不显示文档列表：

- 内容在面板中部成一列，最宽 360px，左对齐。
- 第一行是标题，用一句话说出发生了什么，例如“这个仓库还没有初始化 Concord”。
- 第二行用 `muted` 色说明在哪里或为什么：仓库路径、机器名或缺少的版本。
- 需要用户在终端运行的命令放在代码块里，可以选中复制；需要 mod 执行的操作是一个主按钮。一页最多一个主按钮。

任何一条命令返回 `WorkspaceServerVersionConflict` 时，说明这个仓库的[工作区服务](../local-data-engine/architecture.md#启动与裁决)来自另一个 Concord 安装（例如源码检出、Homebrew 或另一个版本），这台机器上的 `concord` 读不到任何内容。mod 显示状态页：

```text
这个仓库正被另一个 Concord 安装的服务占用
~/code/shop
停止它之后，mod 用这台机器上的 concord 重新启动服务。
[停止它并继续]
```

点“停止它并继续”，mod 在同一台机器、同一仓库运行 `concord --json server stop`，然后重新读取。mod 只在用户点按钮时停止服务，与工作区服务不自动停止已有实例的规则一致。服务被别处停止时，mod 在 2 秒内自动继续。

## 分发构建

`scripts/build-herdr-mod.ts` 负责共享的 mod 打包：固定 tsdown 打包 TypeScript，保留 Herdr/GPUI 外部导入并捆绑其它依赖；不包含本机路径或 source map。独立入口先在临时目录构建并校验文件，再更新 `concord/`；完整归档复用同一构建函数。安装说明、许可证和真实截图随目录提供。行为见[独立交付](../../engineering/build/use-case/share-herdr-mod.md)。

## 安装

`concord herdr install` 复制归档中的 Concord mod 目录，不修改 Herdr 的其它 mod、布局或快捷键。Concord mod 通过 `herdr-app check` 校验。
