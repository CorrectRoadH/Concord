# Web 工作台架构

React Router 管理人用导航，Vite 产物放在安装包 `dist/web`。Node 服务固定一个 Git 工作区，HTTP 只接受严格解码的领域操作，CLI `action --input` 使用相同入口。浏览器不直接写 SQLite、journal、证据或关系注册表。

每次领域操作独立取得、释放 LocalRepository。长期打开网页不占锁。测试由服务拥有的单槽 job 管理，每个 job 使用独立 runner；浏览器断开不取消任务。取消须确认子进程组退出，才能释放锁和运行槽，失败时保留锁并提供诊断。

文档与源码使用一套当前恢复日志，按写入范围区分文档事务和源码事务，不维护历史格式兼容分支。源码事务冻结经过验证的配置范围与身份，仅替换既有 JS/TS 常规文件，不与配置修改混合。prepared 可回滚，committed 只核验完成后的内容；外部改动导致具名冲突，不删除恢复现场。

Web 操作者拥有与本地 CLI 相同的仓库代码执行能力。默认监听 0.0.0.0:4317，不使用访问密钥或身份认证；任何能连接端口的人都可以读取和修改仓库、运行配置的测试命令。Host 接受合法的域名、IPv4 与 IPv6 authority；请求携带 Origin 时必须为 HTTP/HTTPS 且与 Host 匹配；不携带 Origin 的请求仍可访问，默认端口按 Origin 协议归一化。拒绝重复 Host、非法 Origin 和能改变 authority 的请求路径。Host/Origin 校验不提供身份认证或 DNS rebinding 防护。浏览器直接加载工作区，加载失败显示错误并允许重试，刷新保留当前深链接。HTTP 面向可信网络；TLS 终止代理必须保留浏览器使用的外部 Host（含非默认端口），不自动信任代理转发头。Markdown 不执行嵌入脚本或 MDX。
