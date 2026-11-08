# Concord mod 的实现

Concord mod 是可独立分发、也随归档提供的一组 JavaScript 文件：`main.js` 默认导出一个继承 `View` 的类，`mod.json` 声明 `"place": "right"`。它按 Herdr 的 mod 接口绘制原生界面，不包含 HTML、CSS 或网页视图。

接口依据是 herdr-app 的 [mod 指引](https://raw.githubusercontent.com/herdrdev/herdr-app/refs/heads/master/defaults/AGENTS.md)，以及运行中的 Herdr 每次启动时生成的 `herdr.d.ts` 与 `gpui-kit.d.ts`。本页用到的接口：`View` 的 `init`、`render`、`close`；`focused`、`panes`、`spaces`、`theme`；`exec`、`settings`；`on_size_change`、`svg`、`image`；`TextView.markdown`、`TextareaState` 与 `Textarea`、只读源码用的 `EditorState` 与 `Editor`。真实主机上的验收用 `herdr-app check <mod 目录>` 加载 mod，用 `herdr-app shot` 截图核对界面。

## 数据

- 目标 tab：布局侧栏在每次渲染时从 `focused()` 读取当前 tab；没有当前 tab 时显示没有终端。带 `props.pane` 的独立 pane 从 `panes()` 查所属 tab，只跟随这个 tab。切换目标 tab 时停止旧的变化等待，重新解析机器与仓库根；前一目标的异步解析结果不能覆盖当前目标。
- 仓库地址：mod 按 tab 记住最近聚焦的终端 pane，取它的实时 `cwd`（`panes()`）与所在 space 的 `machine`。机器与根目录共同确定仓库；只是进入同一仓库的子目录时保留当前内容。切换 tab 后即使仓库相同也立即刷新，保留选中的文档；换仓库时重新检测 CLI，清除前一仓库的错误。
- 编辑中换仓库：先提交当前输入到原仓库，再切换到最新目标；没有保存或放弃确认。mod 不提供目录选择器，跟随终端已覆盖换仓库的需要。
- 通路：mod 与 Concord 之间没有常驻连接。每个操作是一次 `exec('concord', ['--json', ...], { cwd, on })`，`on` 是仓库地址的机器（本机为 null）；命令在那台机器上找到仓库根，经本机 socket 使用该仓库的[工作区服务](../local-data-engine/architecture.md#cli-查询)。CLI 检测同样带 `on`。本机与远程是同一条通路，mod 不使用 `readTextFile`、`writeTextFile`、`watchFolder` 或 `pickFolder`：后三个只作用于本机，正文与它的摘要又要来自同一次读取。
- 读取：调用[mod 调用的命令](cli.md#mod-调用的命令)；正文用 `action` 的 `file.get` 读取，同时得到它的 `digest`。mod 不缓存结论，每次刷新重新取。
- 写入：停止输入 800ms 或离开块时运行 `concord --json action --input-text <JSON>`，执行 `document.set`。每次写入先用 `file.get` 取得当前摘要作为 `expectedDigest`；遇到 `FileChangedSinceRead` 重新读取并提交当前输入。最多连续尝试三次，持续竞争时报告保存失败。相同文件的写入串行执行，成功后检查；请求返回时只确认它提交的版本，更晚的输入留给下一次保存。文件被删除时不重建。
- 重载：当前文件内容变化时直接替换正文，释放块编辑状态、取消延迟保存并使旧读取与保存回调失效；已经提交给 CLI 的写入由磁盘的实际顺序决定。自身正在提交或刚提交的内容只更新基线，不释放编辑器或清掉后续输入。后台重载不保存被替换的草稿，也不弹冲突与合并界面。
- 刷新：布局侧栏或所属 tab 在前台的独立 pane 循环运行 `concord --json workspace wait --after <sourceDigest>`，命令返回新结果时重新取数据；当前打开的文档与滚动位置保持不变，正文按重载规则更新。独立 pane 所属 tab 不在前台时不等待，回到前台时立即刷新一次。服务不可用（例如 `HawdbUnavailable`）或仓库还没有初始化时，改为每 2 秒重新取一次，所以在终端里运行 `concord init` 后 mod 自动显示文档。
- 连接：`exec` 因机器不可达而失败时显示“连不上 <机器>”，每 2 秒重试，恢复后自动继续。

## 正文渲染

### 原位预览

[原位预览](concepts.md#live-preview)按 Markdown 解析器的顶层节点分块；完整列表、引用、表格和围栏保留为一个可编辑块。点击块后用 Herdr 的多行文本状态在同一位置显示该块的原文，其余块继续渲染；多行文本状态负责选区、输入法与撤销。块编辑期间保留状态实例，渲染和自身保存不重建它。链接事件停止冒泡，继续承担导航。空文档也有可点击的输入区域。

块的起止位置来自原文的 UTF-16 偏移，编辑仅拼接该区间，不重新序列化整篇 Markdown；frontmatter 作为完整块，未知语法保留原文。图片、Mermaid 和 p5 的识别与 `page.render` 共用解析逻辑，图块点击编辑其所属的源码块。没有对应渲染产物或渲染失败时，在块内显示源码与状态；保存完成后由既有渲染通路取得新产物。p5 仍通过系统浏览器播放。

当前页面只有一个活动块和一个延迟保存任务。换块、导航、重载和关闭均回收文本状态与任务；外部重载取消旧草稿的延迟写入。后台渲染携带页面与版本标识，旧产物不能替换新页面；资源文件仍由页面租约释放。

界面见[界面](ui.md)。正文来自 `page.render`（见[渲染一页](cli.md#渲染一页)）：`markdown` 块用 `TextView.markdown`；`image` 与 `mermaid` 块把字节写到 `<appHome>/data/concord/render/<digest>.<扩展名>` 再用 `image()` 显示，因为 `image()` 只读 Herdr 配置目录下的文件。目录只保留当前打开的页面用到的文件，换页与关闭 mod 时删除其它文件。主题变化时重新渲染当前页。`p5` 块的 `html` 写到同一目录，“在浏览器中播放”用 `open_url` 以 `file://` 交给系统浏览器。块编辑用 `TextareaState` 与 `Textarea`，修改的仍是 `file.get` 读到的原文。图标是构建时从固定版本的 Lucide 生成、随 mod 目录分发的 SVG，安装时一起复制，用 `svg()` 着色。面板宽度取自 `on_size_change`，等宽字体取 `settings().font_family`。

## 分发构建

`scripts/build-herdr-mod.ts` 负责共享的 mod 打包：固定 tsdown 打包 TypeScript，保留 Herdr/GPUI 外部导入并捆绑其它依赖；不包含本机路径或 source map。独立入口先在临时目录构建并校验文件，再更新 `concord/`；完整归档复用同一构建函数。安装说明、许可证和真实截图随目录提供。行为见[独立交付](../../engineering/build/use-case/share-herdr-mod.md)。

## 安装

`concord herdr install` 复制归档中的 Concord mod 目录，不修改 Herdr 的其它 mod、布局或快捷键。Concord mod 通过 `herdr-app check` 校验。
