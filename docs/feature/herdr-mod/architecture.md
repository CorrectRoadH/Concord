# Concord mod 的实现

Concord mod 是可独立分发、也随归档提供的一组 JavaScript 文件：`main.js` 默认导出一个继承 `View` 的类，`mod.json` 声明 `"place": "right"`。它按 Herdr 的 mod 接口绘制原生界面，不包含 HTML、CSS 或网页视图。

接口依据是 herdr-app 的 [mod 指引](https://raw.githubusercontent.com/herdrdev/herdr-app/refs/heads/master/defaults/AGENTS.md)，以及运行中的 Herdr 每次启动时生成的 `herdr.d.ts` 与 `gpui-kit.d.ts`。本页用到的接口：`View` 的 `init`、`render`、`close`；`focused`、`panes`、`spaces`、`theme`；`exec`、`settings`；`on_size_change`、`svg`、`image`；`TextView.markdown`、`TextareaState` 与 `Textarea`、只读源码用的 `EditorState` 与 `Editor`。真实主机上的验收用 `herdr-app check <mod 目录>` 加载 mod，用 `herdr-app shot` 截图核对界面。

## 数据

- 目标 tab：布局侧栏在每次渲染时从 `focused()` 读取当前 tab；没有当前 tab 时显示没有终端。带 `props.pane` 的独立 pane 从 `panes()` 查所属 tab，只跟随这个 tab。mod 另以每秒一次的定时任务观察目标 tab、机器和终端目录，不依赖侧栏已经收到重绘；目标没有变化时不通知重绘、不运行命令。关闭 mod 时取消观察。切换目标 tab 时先比较仓库地址；前一目标的异步解析结果不能覆盖当前目标。
- 切换调度：Herdr 的任务回调可以在 `spawn` 调用时立即开始。渲染中观察到新目标时，仓库切换必须先让出宿主执行，再变更会话并通知重绘；缓存命中也遵守这条边界。关闭或再次切换使待执行任务失效，不能恢复旧目标。
- 仓库地址：mod 按 tab 记住最近聚焦的终端 pane，取它的实时 `cwd`（`panes()`）与所在 space 的 `machine`。机器与根目录共同确定仓库；只是进入同一仓库的子目录时保留当前内容。布局侧栏在同一机器、同一仓库的 tab 之间切换时，保留页面、滚动位置、编辑状态与正在进行的变化等待，不触发刷新或 CLI 检测；机器与 cwd 都没变时也不重新解析根目录。换仓库时停止旧的等待，不显示前一仓库的错误。
- 仓库会话：mod 为每个仓库地址保留一份会话：最近一次读到的导航结果与它的 `sourceDigest`、打开的页面与它的渲染结果、滚动位置、文档树展开状态、init 后交给 agent 的请求。切走时会话只挂起：停止变化等待、提交当前输入，结果与状态留在内存。切回时先原样显示保留的内容，同时读一次投影，摘要不同才一次替换，不经过“正在读取”。mod 最多保留最近使用的 8 个会话，超出时关闭最久没用的一个；关闭 mod 时全部释放。只有还没有会话的仓库显示“正在读取 Concord 仓库…”。会话只存在于 mod 进程的内存里，不写文件。
- CLI 检测：按机器记住结果。同一台机器检测通过后，换仓库不再检测；`exec` 找不到 `concord`，或 Concord 回答不认识 mod 用到的命令时，才把这台机器标回未检测并按状态页重新检测。
- 编辑中换仓库：先提交当前输入到原仓库，再切换到最新目标；没有保存或放弃确认。mod 不提供目录选择器，跟随终端已覆盖换仓库的需要。
- 通路：mod 与 Concord 之间没有常驻连接。每个操作是一次 `exec('concord', ['--json', ...], { cwd, on })`，`on` 是仓库地址的机器（本机为 null）；命令在那台机器上找到仓库根，经本机 socket 使用该仓库的[工作区服务](../local-data-engine/architecture.md#cli-查询)。CLI 检测同样带 `on`。远程服务启动由下述 Herdr 托管通路负责。mod 不使用 `readTextFile`、`writeTextFile`、`watchFolder` 或 `pickFolder`：后三个只作用于本机，正文与它的摘要又要来自同一次读取。
- 读取：导航数据来自一次 `concord --json workspace projection`。它返回工作区服务内存中最近接受的[工作区投影](../web-workbench/cli.md#工作区投影)：文档与页面标题、Use Case 的测试与实现、关系、finding 与概念目录，一次 `exec` 就够，不按文档逐个运行 `show`，也不带 `--fresh`。投影的 `current` 恒为 `false`，只用于显示；写入仍以 `file.get` 的摘要为前像。打开的页面另用 `file.get` 与 `page.render` 读当前来源，品味页的依据位置在打开时运行 `taste`。投影报告 `WorkspaceProjectionPending`（服务刚启动或配置刚变化）时，先运行不带 `--after` 的 `workspace wait` 等首份结果再读；服务无法运行（例如 `HawdbUnavailable`，投影报告 `WorkspaceProjectionUnavailable`）时改用一次 `workspace show`，它在本进程扫描当前来源，返回同样的导航结构；仓库还没有初始化时命令返回 `ProjectNotInitialized`。没有运行中的服务时，投影直接读持久保存的上一份结果，刷新循环里的 `workspace wait` 随后启动服务并在新结果就绪时返回。mod 不保存结论到文件：会话里的结果只是上一次读取，每次刷新都以新投影替换。
- 读取成本：已经初始化、服务在运行的仓库，一次刷新是一次 `workspace projection`，与 Feature 数量无关；切回有会话的仓库在拿到新投影之前不运行任何命令就能显示。
- 写入：停止输入 800ms 或离开块时运行 `concord --json action --input-text <JSON>`，执行 `document.set`。每次写入先用 `file.get` 取得当前摘要作为 `expectedDigest`；遇到 `FileChangedSinceRead` 重新读取并提交当前输入。最多连续尝试三次，持续竞争时报告保存失败。相同文件的写入串行执行，成功后检查；请求返回时只确认它提交的版本，更晚的输入留给下一次保存。文件被删除时不重建。
- 重载：当前文件内容变化时直接替换正文，释放块编辑状态、取消延迟保存并使旧读取与保存回调失效；已经提交给 CLI 的写入由磁盘的实际顺序决定。自身正在提交或刚提交的内容只更新基线，不释放编辑器或清掉后续输入。后台重载不保存被替换的草稿，也不弹冲突与合并界面。
- 刷新：布局侧栏或所属 tab 在前台的独立 pane 循环运行 `concord --json workspace wait --after <sourceDigest>`，命令返回新的 `sourceDigest` 时重新读一次投影；当前打开的文档与滚动位置保持不变，正文按重载规则更新。独立 pane 所属 tab 不在前台时不等待，回到前台时立即刷新一次。服务不可用（例如 `HawdbUnavailable`）或仓库还没有初始化时，改为每 2 秒重新取一次，所以在终端里运行 `concord init` 后 mod 自动显示文档。
- 连接：`exec` 因机器不可达而失败时显示“连不上 <机器>”，每 2 秒重试，恢复后自动继续。
- 读取失败：当前仓库的只读刷新返回错误后，每 2 秒重试一次，正在读取时不叠加请求；成功后清除错误。切换仓库或关闭时取消重试，不重放失败的写入。
- 命令错误：分别从 stderr 与 stdout 解码具名错误；日志和告警不能遮住另一个输出流或同一流内独立 JSON 行中的错误。交给 agent 的详情保留两个输出流。初始化回执一旦成功就保留，随后的读取失败说明初始化已完成，并沿用只读刷新重试。

### 远程服务与读取终止

Herdr 的远程 `exec` 经 `hc exec` 执行；这个调用结束时会回收它的全部后代，包括 detached 进程。Concord mod 因此在每次远程业务命令之前运行 `concord --json server status`。服务不存在时，在 Herdr 宿主本机执行 `hc run --on <machine> --cwd <root> --bg --no-parent --rm -- concord server run --root <root>`，由 Herdr core 在指定机器与仓库创建独立后台终端托管前台服务。启动不依赖远端命令环境能从 PATH 找到 `hc`。已有兼容服务时直接使用，不启动新终端。本机保持原有 CLI 启动方式。

状态中的 `compatible` 同时核对协议与当前 CLI 的安装身份；为假时，只运行 `server stop --token <token>` 停止该实例，再重新查询状态。若并发替换已经产生兼容实例则复用；不存在才托管启动。一次准备最多停止一个实例、托管启动一次，之后仍不兼容就报告 `WorkspaceServerBusy`，不循环替换。服务控制命令不递归准备服务；`init` 在当前命令中执行，也跳过准备，成功后的刷新遵守准备规则。所有远程业务命令使用公开的 `--server=existing`，确保状态检查之后服务消失或安装变化时只报告 `WorkspaceServerUnavailable`，不在短 exec 内启动或替换服务。读取按只读刷新规则重试，写入不重放。选项与状态字段见[检查与停止服务实例](../local-data-engine/cli.md#检查与停止服务实例)。

终端不创建 pane 或 tab，不抢焦点，不附加界面标签；没有父终端，不依赖短查询或 mod 的生命周期。工作区服务仍拥有持久句柄、服务锁与子进程，按既有退出协议回收；服务退出后 `--rm` 删除终端。mod 切换仓库、关闭或重连不停止共享服务。并发启动由 Concord 的服务锁裁决，落败进程退出，其终端同样自动删除。不得通过删除 `HC_SCOPE` 等宿主标记逃避回收，也不修改 Herdr 的全局环境或启动普通查询之外的应用。

`hc run` 返回零只说明终端创建成功。创建后先运行 `concord --json server status --wait`，这个只读命令最多等 10 秒，直到服务完成握手，绝不自动启动服务；确认 `compatible: true` 后才运行业务命令，避免查询抢先启动一个随 exec 退出的临时服务。投影可读仍由随后成功的 `workspace projection` 证明。创建终端的非零结果转换为 `HerdrServiceStartFailed`，保留 stdout/stderr 供交给 agent；机器不可达仍按连接失败处理。握手超时报告 `WorkspaceServerUnavailable`。服务在 status 与业务命令之间退出，或另一 CLI 替换服务时，本轮结果不能证明服务仍存在，下一次读取重新检查并按需托管；不重放写入。服务升级、锁争用与不可用的错误继续由 Concord 的公开命令处理。

一次刷新最多读取三次投影，中间最多等待两次；等待不带 `--after`，使用 CLI 默认的 25 秒期限。第三次仍返回 `WorkspaceProjectionPending` 时，将这个具名错误交给状态页，停止本轮读取，不再等待。已经读到的内容保留；没有内容时显示错误和交给 agent 的请求。切换目标后旧读取不能更新新会话。后台变化等待保留 `--after <sourceDigest>`，每次等待前同样确认远程服务；控制查询不计作导航刷新，已有兼容服务时，每个远程业务命令只增加一次状态查询，导航仍只读取一次投影（[快到每次都愿意跑](../../taste.md#t-7)）。

验收用真实 CLI 与临时仓库观察：远程短命令回收完其后代后，独立托管的工作区服务仍能被后续命令复用；mod 先启动后由终端直接查询、终端先启动后由 mod 查询，两种顺序都保持同一个服务 PID；两个并发启动最多保留一个服务；停止服务后托管终端删除。持续 pending 的替身只模拟命令边界，验证第三次失败能到达状态页，不复制服务实现。

宿主启动命令自身无法运行时也报告 `HerdrServiceStartFailed`，保留异常详情；远端查询仍按连接错误处理。宿主启动失败不能显示成远端机器断线。

## 正文渲染

主动导航先在 View 中记录待打开的路径，立即更新列表高亮与右栏读取提示；会话仍保留已读页面，待原页输入保存、目标正文读取完成后才替换。导航回调绑定仓库会话与导航标识，过期回调不能清除新导航的读取提示或报告错误。换仓库时清除待打开路径。读取失败时撤销待打开路径，显示已读页面与错误横幅。

源码预览与概念卡片各自拥有请求标识及读取状态。新请求、关闭和导航使对应标识失效；返回结果与错误前核对标识、页面、仓库会话和面板生命周期。图块加载状态来自当前渲染请求，渲染失败后停止占位并保留源码。保存会话在写入和检查阶段变化时通知 View；检查失败与写入失败分别显示，不把上一轮检查当成本轮结果。仓库解析期间由目标状态页隔离原页面，已有会话继续按缓存恢复规则展示。

### 原位预览

正文读取任务在接受来源时准备分块，同一原文复用解析结果；View 的重绘不调用 Markdown 解析器。编辑器保留开始编辑时的分块与原文，输入时只更新草稿；离开块或换块时准备修改后的分块。渲染产物保留其来源分块的图块索引，因此新正文与旧产物并存时也不在重绘中重新解析。缓存属于仓库会话、活动编辑块或当前渲染产物，随它们替换与释放，不建立全局正文缓存（[快到每次都愿意跑](../../taste.md#t-7)）。Concord 不按正文长度设上限，也不修改 Herdr 的执行期限。

[原位预览](concepts.md#live-preview)按 Markdown 解析器的顶层节点分块；完整列表、引用、表格和围栏保留为一个可编辑块。点击块后用 Herdr 的多行文本状态在同一位置显示该块的原文，其余块继续渲染；多行文本状态负责选区、输入法与撤销。块编辑期间保留状态实例，渲染和自身保存不重建它。链接事件停止冒泡，继续承担导航。空文档也有可点击的输入区域。

块的起止位置来自原文的 UTF-16 偏移，编辑仅拼接该区间，不重新序列化整篇 Markdown；frontmatter 作为完整块，未知语法保留原文。图片、Mermaid 和 p5 的识别与 `page.render` 共用解析逻辑，图块点击编辑其所属的源码块。没有对应渲染产物或渲染失败时，在块内显示源码与状态；保存完成后由既有渲染通路取得新产物。p5 仍通过系统浏览器播放。

当前页面只有一个活动块和一个延迟保存任务。换块、导航、重载和关闭均回收文本状态与任务；外部重载取消旧草稿的延迟写入。后台渲染携带页面与版本标识，旧产物不能替换新页面；资源文件随页面关闭释放。

界面见[界面](ui.md)。正文来自 `page.render`（见[渲染一页](cli.md#渲染一页)）：`markdown` 块用 `TextView.markdown`；`image` 与 `mermaid` 块把字节写到 `<appHome>/data/concord/render/<digest>.<扩展名>` 再用 `image()` 显示，因为 `image()` 只读 Herdr 配置目录下的文件。目录只保留当前打开的页面用到的文件，换页与关闭 mod 时删除其它文件。主题变化时重新渲染当前页。`p5` 块的 `html` 写到同一目录，“在浏览器中播放”用 `open_url` 以 `file://` 交给系统浏览器。块编辑用 `TextareaState` 与 `Textarea`，修改的仍是 `file.get` 读到的原文。图标是构建时从固定版本的 Lucide 生成、随 mod 目录分发的 SVG，安装时一起复制，用 `svg()` 着色。面板宽度取自 `on_size_change`，等宽字体取 `settings().font_family`。

## 分发构建

`scripts/build-herdr-mod.ts` 负责共享的 mod 打包：固定 tsdown 打包 TypeScript，保留 Herdr/GPUI 外部导入并捆绑其它依赖；不包含本机路径或 source map。独立入口先在临时目录构建并校验文件，再更新 `concord/`；完整归档复用同一构建函数。安装说明、许可证和真实截图随目录提供。行为见[独立交付](../../engineering/build/use-case/share-herdr-mod.md)。

## 安装

`concord herdr install` 复制归档中的 Concord mod 目录，不修改 Herdr 的其它 mod、布局或快捷键。Concord mod 通过 `herdr-app check` 校验。
