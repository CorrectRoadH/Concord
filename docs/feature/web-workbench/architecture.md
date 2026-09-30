# Web 工作台架构

React Router 管理人用导航，Vite 产物放在安装包 `dist/web`。Node 服务固定一个 Git 工作区，HTTP 只接受严格解码的领域操作，CLI `action --input` 使用相同入口。浏览器不直接写 HawDB、journal、证据或关系注册表。

工作台根地址进入 `/git`，总览位于 `/overview`。Git 页默认列出全部未提交文件，文档与测试作为筛选；Git 读取失败独立显示错误和重试入口，不伪装为空列表。PR 静态产物的比较身份与发布边界见[变更预览](change-preview.md)。

反馈列表使用 `/feedback`，详情使用 `/feedback/:id`。页面链接直接使用当前路由，不维护版本兼容别名。

结构化术语由 `docs/**/concepts.json` 拥有，目录决定作用域；文档术语页通过 concepts 工具读取当前文档目录的有效定义、直接导入与来源诊断，不解析 Markdown 表格或自行实现第二套合成规则。`docs/concepts.md` 保留为可编辑的解释页面。全项目汇总与写作页共享同一后端 JSON 来源，不建立术语注册表。

`docs/` 下不属于 Feature、Roadmap、Design、Research、Engineering、Issue 或 Memory 来源的 Markdown 进入同一 inventory，由「文档」导航打开。`docs/constitution.md` 提供专用正文编辑入口，草稿采用与正式修订分别调用 constitution adopt 与 amend；普通 document.set 仍不能覆写宪法元数据与历史。阅读不是合规证据。

`docs/README.md`、`docs/architecture.md`、`docs/concepts.md`、`docs/concord.md` 和 `docs/_template/` 下无 frontmatter 的参考模板沿用支持页面的摘要保护写入。其余未授权路径只读。单文件读取仍不枚举全仓库。

只读 Markdown 按 [MDXEditor 官方建议](https://mdxeditor.dev/editor/docs/overview) 使用独立阅读渲染器。复用 react-markdown，通过 remark-frontmatter 识别元数据；rehype-raw 后接 rehype-sanitize，不使用未经净化的 HTML。保留净化器的 DOM clobbering 前缀，由阅读导航映射源锚点，不能为保留锚点关闭净化。正文和原文／元数据详情来自同一读取结果；预览不产生写入或自动归一化。可编辑正文继续使用 MDXEditor 及原文回退，错误不得清空草稿。

参考模板树从现有 inventory 的路径派生，由共享 ContentSidebar 渲染；不新增存储索引。树形导航采用 [WAI 折叠导航模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) 的嵌套列表、aria-expanded 按钮和 aria-current 链接。目录展开是展示状态，文件选择由 URL 拥有；筛选和当前文件定位不建立另一份导航来源。

每次领域操作独立取得、释放 LocalRepository。长期打开网页不占锁。测试由服务拥有的单槽 job 管理，每个 job 使用独立 runner；浏览器断开不取消任务。取消须确认子进程组退出，才能释放锁和运行槽，失败时保留锁并提供诊断。

工作区请求读取独立 HawDB workspace_projection 命名空间的一条结构记录。服务持有刷新租约，扫描子进程编译候选，父进程重新核验身份后原子发布。完整协议见[工作区只读投影](../../design/workspace-projection/plans/shared-projection/PROTOCOL.md)。

后台编译复用 trace 生成诊断。文档与代码的纯解析结果使用有容量上限的 HawDB 内存缓存，以当前原文匹配；目录集合、文件读取、路径安全、配置、租约及恢复检查仍每次执行，不以时间戳代替内容校验。单文件预览只读取目标和其 README 归属链，全局 inventory 异常由 workspace/check 诊断。Git 测试基线在 HawDB 内存 namespace 中按 worktree、不可变 HEAD revision、测试根与解析器版本缓存，工作树状态仍实时读取。

浏览器每四秒轮询任务状态，每三十二秒申请一次工作区刷新；首次构建期间每两秒重试读取缓存。写入后的读取排在已有读取之后，并立即申请后台刷新。首次取得工作区后不立即重复读取。同一 Research 主题内切换文件保留文件树节点、折叠和滚动状态，加载占位保持工具栏布局。

工作区响应带基于结构代次与刷新状态的 ETag。每次严格解码缓存，内容未变时返回 304。刷新失败保留可读代次并展示错误；缓存不可读返回具名不可用。正文与编辑前像统一从 `/api/file` 当前读取，不从历史代次确认保存。

文档与源码使用一套当前恢复日志，按写入范围区分文档事务和源码事务，不维护历史格式兼容分支。源码事务冻结经过验证的配置范围与身份，仅替换既有 JS/TS 常规文件，不与配置修改混合。prepared 可回滚，committed 只核验完成后的内容；外部改动导致具名冲突，不删除恢复现场。

Web 操作者拥有与本地 CLI 相同的仓库代码执行能力。默认监听 0.0.0.0:4317，不使用访问密钥或身份认证；任何能连接端口的人都可以读取和修改仓库、运行配置的测试命令。

Host 接受合法的域名、IPv4 与 IPv6 authority。请求携带 Origin 时必须为 HTTP/HTTPS 且与 Host 匹配；不携带 Origin 的请求仍可访问，默认端口按 Origin 协议归一化。拒绝重复 Host、非法 Origin 和能改变 authority 的请求路径。Host/Origin 校验不提供身份认证或 DNS rebinding 防护。

浏览器加载结构投影；首次构建中自动重试，缓存不可用显示具体错误与恢复动作，刷新保留当前深链接。HTTP 面向可信网络；TLS 终止代理必须保留浏览器使用的外部 Host（含非默认端口），不自动信任代理转发头。Markdown 中只有显式 p5 图块经专用沙箱运行，普通 HTML 脚本和 MDX 不执行。

## p5 图解

编辑器与阅读渲染器共用 p5 组件。`POST /api/p5/compile` 严格解码文档路径、源码和选项，验证文档可读后捕获相对依赖。读取使用乐观快照，编译后核对读取文件的字节。TypeScript 检查只访问捕获的模块与随包的可信类型；esbuild 不使用消费者的插件、构建配置或包解析，不在服务端执行 sketch。

编译结果只在当前浏览器使用，不生成文件 owner 或持久缓存。`/p5-frame` 提供随包的 p5 运行时，iframe 与响应 CSP 同时设置无同源权限的沙箱。子页面使用独立 CSP，父工作台不开放内联脚本；API 和其他页面拒绝 frame 导航。来源窗口与消息 Schema 共同限制控制消息，沙箱不拥有读取仓库的消息接口。

仅 p5 子页面允许动态函数生成，以兼容核心校验器与 shader 功能；该权限不扩展到父工作台，也不授予同源、网络或仓库访问能力。

CSS 与静态资源进入当前图块的编译结果。项目配置的 `p5.libraries` 拥有库选择与加载顺序，Markdown 不覆盖该集合。内建扩展按固定名称和版本选择，本地扩展相对项目根解析，自定义逻辑模块以相对文件导入；联网和设备权限不随绘图库 API 自动开放。运行停止或组件卸载时移除 iframe，释放该浏览上下文的资源。支持范围和预算由[交互图解契约](use-case/embed-p5-sketch.md)拥有。

## 项目测试只读投影

存在 `concord.repository.json` 时，工作区在已有仓库租约内严格读取 profile 配置，复用 `compileTraceUnderLease` 和 `showFeature`，从用户已写入的测试注释、Engineering owner 与 Feature／Use Case 派生关系。内部 `repositoryTests` 投影返回读取状态、测试身份、路径、owner、契约、执行器与运行通道，不写第二份登记表、不加载宿主模块。Web 将它与通用 case 投影统一呈现为用户已关联的测试；profile 测试仍由原有宿主 CLI 执行。

测试页合并呈现两种来源并标注来源；Feature 汇总使用 profile 自身的归属规则，Use Case 匹配原始契约。实现页按 Feature 公共实现及各个 Use Case 分组，只展示明确关联的实现文件、符号、范围和契约；同一源码可出现在多个实际关联组。测试文件保留在测试页。点击实现位置打开源码并选择对应行范围；空组提供预填当前契约的关联入口。未配置目录、扫描失败、筛选无匹配和确实无关联分别呈现；profile 失败不得回退成空列表成功。

服务将慢请求写入 stderr：处理耗时或采样到的事件循环延迟达到 250 ms 时，记录方法、规范化路由、状态、完成标志、耗时、阶段及有限原因标签。每分钟最多 20 条，后续记录带被抑制数量；stderr 积压达到 64 KiB 时跳过。阶段至多 24 个命名项及一个汇总项，不记录请求正文、查询参数、文件路径、请求头或原始错误详情。

扫描计时区分测试注释、文档关系、宪法、代码来源读取、缓存与解析、来源复核。日志分别记录测试和代码缓存的状态及命中数，不可用原因只输出允许的错误码。`cache status` 的 ready 不作为请求命中证据。公共扫描与缓存批处理见[架构流程图](../../architecture.md#存储契约)；Web 复用该流程，不拥有另一套解析缓存。

处理耗时从 HTTP handler 接纳请求开始；事件循环延迟为进程采样观察，不能作为该请求的精确排队时间。嵌套阶段时间包含子阶段，不能相加。客户端全程耗时应由独立进程测量。HTTP 200 只表示响应成功，列表须读取 projection.consistent、complete 和 findings；缓存不可用、扫描期间来源变化与孤立标注分别诊断。
