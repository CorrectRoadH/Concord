# Web 工作台与 AI CLI

在目标 Git 工作区运行 `concord view`，或显式使用 `concord --root <worktree> view`。默认监听 `0.0.0.0:4317`；`--host 127.0.0.1` 限制本机访问，`--port` 调整端口。浏览器打开终端显示的地址即可进入工作台，无需登录或访问密钥。

启动输出分别列出实际 Host / Port、Local 与各网卡 Network URL。域名和 NAT 入口也可用；反向代理必须保留浏览器使用的外部 Host（含非默认端口），不依赖 forwarded headers 绕过检查。修改安装代码后需重启已有 view 进程才能生效。

服务不做身份认证；任何能连接该端口的人都可以读取和修改仓库、修改配置并执行测试，拥有服务进程的代码执行权限。明文 HTTP 只用于可信网络；远程使用安全通道。首版不自动信任反向代理的转发头。

Feature、Engineering、Roadmap、Design、Research 是侧栏入口；Use Case 必须归属于 Feature，在 Feature 内创建和浏览。「文档」列出 `docs/` 下没有分类 owner 的项目文档和参考模板，例如架构与宪法。宪法只读，不能在工作台里改写成合规证据。正文用富文本编辑，元数据与生命周期由单独操作管理。未知 Markdown 可用源码视图，初始加载不会自动保存归一化内容。

Markdown 的 `p5` 代码块在阅读与编辑页面由读者显式点击运行。内联块可写 `p.setup`、`p.draw` 或默认导出实例函数。外部入口用 `src="./demo/main.ts"`，可用 `css="./demo/style.css"`；两者均相对 Markdown。

项目扩展统一由 `concord.config.ts` 的 `p5: { libraries: ['p5.sound', 'p5.brush', './vendor/addon.js'] }` 声明，按声明顺序加载。Markdown 不接受 `libraries` 选项；省略配置只加载 p5 核心。自定义传统库用项目根相对 `.js` 路径，模块代码通过相对 `import` 引入。只配置实际需要且兼容当前 p5 的库，内建名称为 `p5.sound` 与 `p5.brush`；其它库不自动安装。

项目启用 `p5.brush` 后所有图块都会加载它，画布须满足该库的 WebGL 要求；下面的普通 2D 示例使用仅核心或只启用 `p5.sound` 的配置。

保留 Mermaid 表达结构和流程；需要动画或交互时，在文档中加入以下完整示例，并在图旁说明想让读者观察什么：

````markdown
```p5
import type P5 from 'p5';
export default function (p: P5) {
  p.setup = () => {
    p.createCanvas(480, 180);
    p.describe('圆点随时间左右往复运动');
  };
  p.draw = () => {
    p.background(245);
    p.circle(240 + 160 * p.sin(p.millis() / 1000), 90, 30);
  };
}
```
````

多文件图解使用空的引用块，路径相对 Markdown：

````markdown
```p5 src="./demo/main.ts" css="./demo/style.css"
```
````

`main.ts` 默认导出 `(p: P5) => void`，类型用 `import type P5 from 'p5'` 引入；`.js` / `.mjs` 也可作为入口。传统全局函数示例使用 `mode="global"`，例如 `function setup()` 与 `function draw()`。CSS 和 p5 DOM 控件只影响当前图块。图片等资源应通过相对 `import` 获得内嵌 URL；`loadImage('./image.png')` 不会自动读取仓库文件。

每个图块显式运行，在 opaque-origin 沙箱内执行完整固定版本 p5 核心；没有父 DOM、仓库 API、外网或设备权限。音频播放需要图块内用户手势，麦克风不可用。暂停控制绘制循环，停止或离开文档销毁图块；一般错误显示在图块中，同步死循环不保证可强制终止。运行不保存文档，编辑源码仍走正常自动保存。不要把第三方库全部描述为已兼容，也不要把动画运行当作产品验收。

AI 继续优先使用已有 CLI 命令与 `--json`。新增结构化操作可由 `concord action --input <file|->` 调用，与 Web 共用校验。先读取当前摘要，再提交正文、源码或配置更新；`PreimageChanged` 表示文件被外部修改，重新读取、合并意图后重试，不能强行覆盖。

Git 面板显示已暂存（HEAD 对 index）、未暂存（index 对工作区）与未跟踪文件。它与编辑器内未保存的差异不是同一比较。查看 Git 不隐含暂存、提交、回滚或 push 授权。

服务空闲时不持仓库锁，CLI 可以正常协作。测试运行持锁至进程清理完成；取消后等任务终态再继续写改。`cleanup-failed` 必须保留现场，不用删锁来掩盖尚未确认退出的进程。

证据、历史和身份字段通过受管操作维护，不能当普通 JSON 任意编辑。损坏的配置或 frontmatter 显示原文诊断，无法确认的身份与历史需本机修复。高级原生执行使用项目声明的能力，静态 Web 关系不能表述为原生执行证据。
