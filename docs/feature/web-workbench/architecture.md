# Web 工作台架构

React Router 管理人用导航，Vite 产物放在安装包 `dist/web`。Node 服务固定一个 Git 工作区，HTTP 只接受严格解码的领域操作，CLI `action --input` 使用相同入口。浏览器不直接写 HawDB、journal、证据或关系注册表。

结构化术语由 `docs/**/concepts.json` 拥有，目录决定作用域；文档术语页通过 concepts 工具读取当前文档目录的有效定义、直接导入与来源诊断，不解析 Markdown 表格或自行实现第二套合成规则。`docs/concepts.md` 保留为可编辑的解释页面。全项目汇总与写作页共享同一后端 JSON 来源，不建立术语注册表。

`docs/` 下不属于 Feature、Roadmap、Design、Research、Engineering、Issue 或 Memory 来源的 Markdown 进入同一 inventory，由「文档」导航打开。`docs/constitution.md` 提供专用正文编辑入口，草稿采用与正式修订分别调用 constitution adopt 与 amend；普通 document.set 仍不能覆写宪法元数据与历史。阅读不是合规证据。`docs/README.md`、`docs/architecture.md`、`docs/concepts.md`、`docs/concord.md` 和 `docs/_template/` 下无 frontmatter 的参考模板沿用支持页面的摘要保护写入。其余未授权路径只读。单文件读取仍不枚举全仓库。

只读 Markdown 按 [MDXEditor 官方建议](https://mdxeditor.dev/editor/docs/overview) 使用独立阅读渲染器。复用 react-markdown，通过 remark-frontmatter 识别元数据；rehype-raw 后接 rehype-sanitize，不使用未经净化的 HTML。保留净化器的 DOM clobbering 前缀，由阅读导航映射源锚点，不能为保留锚点关闭净化。正文和原文／元数据详情来自同一读取结果；预览不产生写入或自动归一化。可编辑正文继续使用 MDXEditor 及原文回退，错误不得清空草稿。

参考模板树从现有 inventory 的路径派生，由共享 ContentSidebar 渲染；不新增存储索引。树形导航采用 [WAI 折叠导航模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) 的嵌套列表、aria-expanded 按钮和 aria-current 链接。目录展开是展示状态，文件选择由 URL 拥有；筛选和当前文件定位不建立另一份导航来源。

每次领域操作独立取得、释放 LocalRepository。长期打开网页不占锁。测试由服务拥有的单槽 job 管理，每个 job 使用独立 runner；浏览器断开不取消任务。取消须确认子进程组退出，才能释放锁和运行槽，失败时保留锁并提供诊断。

读取工作区启用 HawDB 测试索引缓存，同一次请求复用 trace 生成诊断。文档与代码的纯解析结果使用有容量上限的 HawDB 内存缓存，以当前原文匹配；目录集合、文件读取、路径安全、配置、租约及恢复检查仍每次执行，不以时间戳代替内容校验。单文件预览只读取目标和其 README 归属链，全局 inventory 异常由 workspace/check 诊断。Git 测试基线在 HawDB 内存 namespace 中按 worktree、不可变 HEAD revision、测试根与解析器版本缓存，工作树状态仍实时读取。

浏览器在上一轮刷新完成后等待四秒再轮询，写入后的刷新排在已有读取之后。首次取得工作区后不立即重复读取。同一 Research 主题内切换文件保留文件树节点、折叠和滚动状态，加载占位保持工具栏布局。

工作区响应带基于完整响应内容的 ETag。每次仍读取并核验当前状态，内容未变时返回无正文的 304；浏览器复用已有快照对象，避免重复传输、JSON 解析及整页渲染。错误响应不使用此前快照替代。

文档与源码使用一套当前恢复日志，按写入范围区分文档事务和源码事务，不维护历史格式兼容分支。源码事务冻结经过验证的配置范围与身份，仅替换既有 JS/TS 常规文件，不与配置修改混合。prepared 可回滚，committed 只核验完成后的内容；外部改动导致具名冲突，不删除恢复现场。

Web 操作者拥有与本地 CLI 相同的仓库代码执行能力。默认监听 0.0.0.0:4317，不使用访问密钥或身份认证；任何能连接端口的人都可以读取和修改仓库、运行配置的测试命令。Host 接受合法的域名、IPv4 与 IPv6 authority；请求携带 Origin 时必须为 HTTP/HTTPS 且与 Host 匹配；不携带 Origin 的请求仍可访问，默认端口按 Origin 协议归一化。拒绝重复 Host、非法 Origin 和能改变 authority 的请求路径。Host/Origin 校验不提供身份认证或 DNS rebinding 防护。浏览器直接加载工作区，加载失败显示错误并允许重试，刷新保留当前深链接。HTTP 面向可信网络；TLS 终止代理必须保留浏览器使用的外部 Host（含非默认端口），不自动信任代理转发头。Markdown 不执行嵌入脚本或 MDX。

## 项目测试只读投影

存在 `concord.repository.json` 时，工作区在已有仓库租约内严格读取 profile 配置，复用 `compileTraceUnderLease` 和 `showFeature`，从用户已写入的测试注释、Engineering owner 与 Feature／Use Case 派生关系。内部 `repositoryTests` 投影返回读取状态、测试身份、路径、owner、契约、执行器与运行通道，不写第二份登记表、不加载宿主模块。Web 将它与通用 case 投影统一呈现为用户已关联的测试；profile 测试仍由原有宿主 CLI 执行。

测试页合并呈现两种来源并标注来源；Feature 汇总使用 profile 自身的归属规则，Use Case 匹配原始契约。实现页按 Feature 公共实现及各个 Use Case 分组，只展示明确关联的实现文件、符号、范围和契约；同一源码可出现在多个实际关联组。测试文件保留在测试页。点击实现位置打开源码并选择对应行范围；空组提供预填当前契约的关联入口。未配置目录、扫描失败、筛选无匹配和确实无关联分别呈现；profile 失败不得回退成空列表成功。
