# 文件格式

本页声明工作台读写的两种文件：

- [PR 预览产物](#pr-预览产物)：`concord view export` 输出的目录，由消费者托管、审阅者打开。调用与错误见 [PR 静态预览导出](cli.md#pr-静态预览导出)，Schema 由 `concord schema change-preview` 输出、`concord view verify` 校验，用户路径见[在 PR 预览中审阅变更](use-case/review-pull-request.md)。
- [p5 图块](#p5-图块)：Markdown 中由工作台运行、可以交互的图解。用户路径见[在 Markdown 中运行 p5 图块](use-case/embed-p5-sketch.md)。

## PR 预览产物

### 输出目录

输出固定为 `index.html`、`changes.json`、`assets/` 与字体许可证 `FONT-LICENSE.html`，资源从随包静态目录派生，不含 symlink。链接相对输出目录，页面可部署在子路径。

页面地址的 hash query 拥有：

| 参数 | 取值 |
| --- | --- |
| `path` | 选中的条目路径 |
| `view` | `unified` 或 `split` |
| `content` | `diff`、`before` 或 `after` |

输出不含凭据、未提交文件或 Git metadata。

### changes.json

`changes.json` 的格式为 `concord.change-preview/v1`。解码拒绝未知字段与版本。

| 字段 | 语义与约束 |
| --- | --- |
| format | 字面量 `concord.change-preview/v1` |
| comparison | base、head、mergeBase 为同一对象格式的 40 或 64 位小写十六进制 ID；baseLabel 为非空纯文本，最多 256 字符，只作展示，默认等于输入的 base |
| entries | 最多 2000 项；path 唯一，取 head 路径，删除时取旧路径；UTF-8 仓库相对路径，无 NUL、空段、`.` 或 `..` |
| entry.status | A、D、M、R、T；R 必须有与 path 不同的 previousPath，其余不得有 |
| entry.before / after | null 表示该侧不存在，否则为 `{oid, mode}`；mode 为字符串 100644、100755、120000 或 160000；before 取 mergeBase 的 previousPath 或 path，after 取 head 的 path；A 的 before、D 的 after 必须为 null，其余两侧都存在，oid 长度与 comparison 一致 |
| entry.patch / binary | patch 为统一差异文本；二进制、纯模式变化与内容不变的 rename 的 patch 可为空字符串，界面仍显示状态与两侧对象 |
| entry.beforeMarkdown / afterMarkdown | 仅当对应侧为普通文件模式、后缀 `.md`/`.markdown` 且非二进制时存在；空字符串是空正文，缺失表示不适用 |

gitlink 只显示 commit ID，symlink 只显示 blob，不跟随。非 UTF-8 或含 NUL 的正文按二进制处理。

## p5 图块

### 内联图块

围栏语言为 `p5` 的代码块是 p5 图块，其它语言的代码块只显示源码。默认是实例模式：正文可直接使用带 p5 类型的 `p`，可以写辅助函数、状态与类，使用项目依赖清单所选 p5 的完整核心 API。

````markdown
```p5
p.setup = () => {
  p.createCanvas(320, 120);
};
p.draw = () => {
  p.background(245);
  p.circle(p.frameCount % 320, 60, 40);
};
```
````

内联正文也可以是完整的 TypeScript 模块：用 `import type P5 from 'p5'` 引入类型，并包含 `export default function (p: P5) { … }`。

### 外部入口

````markdown
```p5 src="./queue/main.ts" css="./queue/style.css"
```
````

- 引用外部入口的图块正文必须为空，源码只由外部文件拥有。
- `src` 与 `css` 相对 Markdown 文件解析；入口内部的相对引用以当前模块为基准。
- 入口支持 `.ts`、`.js` 与 `.mjs`，实例模式的入口必须默认导出实例函数。
- 入口及其依赖必须位于当前 Git 仓库内，不能是 symlink、隐藏目录、隐藏文件或 `node_modules` 中的文件。
- 模块导入使用相对路径。`p5` 的类型与运行库由 Concord 提供；Concord 不运行消费者的构建配置或安装脚本。

```ts
import type P5 from 'p5';

export default function sketch(p: P5) {
  p.setup = () => {
    p.createCanvas(480, 200);
    const button = p.createButton('重新绘制');
    button.class('restart');
    button.mousePressed(() => p.redraw());
    p.noLoop();
  };
  p.draw = () => p.background(p.random(255));
}
```

### 全局模式

`mode="global"` 让内联或外部入口使用顶层的生命周期与事件函数声明，例如 `function setup()`、`function draw()`，不要求默认导出。每个图块拥有独立的全局对象。p5 2.x 的异步资源在 `async setup()` 中等待；不承诺所有 p5 1.x 程序原样兼容。

### 输入检查

TypeScript 输入按严格类型检查；`.js` 与 `.mjs` 是合法的图块输入，这不是 Concord 实现代码的语言例外。语法、类型、路径、依赖或预算失败时显示具名诊断并保留原文。依赖越界、symlink、隐藏路径、未知扩展库与远程 import 被拒绝；编译不执行作者代码。编译结束时核对读到的每个文件，字节变化时返回 `P5SourceChanged`。

| 对象 | 上限 |
| --- | --- |
| 每次编译读取的路径 | 128 个 |
| 输入合计 | 8 MiB |
| 单个内联正文 | 256 KiB |
| 编译输出 | 16 MiB |

失败不留下文件或持久句柄。

### 样式与资源

sketch 可以创建自己的画布、DOM 控件与容器，用 p5 的元素样式 API 或 CSS 实现布局、伪类、媒体查询与动画。CSS 只作用于当前沙箱，不影响工作台；画布内的图形样式由 p5 绘图 API 控制。WebGL 由 p5 核心提供。

受支持的图片、字体、音视频与 STL 文件经相对模块导入得到内嵌的资源 URL。JSON 导入为数据，文本、OBJ 与 shader 文件导入为字符串。CSS 中相对的 `url()` 资源随图解打包。`loadImage('./image.png')` 这样的运行时字符串不会读取仓库文件；先导入资源 URL，再交给对应的 p5 API。

### 扩展库

默认只加载固定版本的 p5 核心。扩展库由项目的 `concord.config.ts` 统一声明，Markdown 不声明也不覆盖库集合：

```ts
p5: {
  libraries: ['p5.sound', 'p5.brush', './vendor/addon.js'],
},
```

- `p5.libraries` 最多 16 个不重复条目。内建名称对应随 Concord 固定的版本，见[依赖选型](architecture.md#依赖选型)；自定义 `.js` 路径相对项目根解析。
- 没有配置或列表为空时只加载 p5 核心。未知名称返回诊断，不联网下载，也不自动安装。
- 所有图块在各自的沙箱内按声明顺序加载同一组库，然后运行 sketch。扩展与 sketch 共用同一个沙箱与资源预算，不获得工作台权限。
- 设置通过现有的配置更新与前像校验维护，不另设依赖登记文件。

作者自己的 JS / TS 逻辑与资源用相对模块导入。Concord 不解析任意 npm 包，不提供远程 CDN 或通用前端项目入口。第三方扩展的注册形式、类型声明与 p5 版本兼容性由项目作者核对。`p5.collide2d` 因 NC 许可不作为内建扩展，其它扩展也不声明为已验证兼容。

### 主题变量

图块与 Mermaid 图使用同一组工作台主题色。沙箱文档的根元素带有这些 CSS 变量，sketch 可以在 CSS 中使用，也可以在绘制时读取：

```ts
const theme = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
p.draw = () => {
  p.background(theme('--concord-bg'));
  p.fill(theme('--concord-accent'));
};
```

| 变量 | 含义 |
| --- | --- |
| `--concord-bg`、`--concord-fg` | 背景与正文颜色 |
| `--concord-muted` | 次要线条与说明文字 |
| `--concord-accent` | 当前阶段等强调色 |
| `--concord-series-1` 到 `--concord-series-8` | 多条数据或多个参与方的区分色 |
| `--concord-font` | 正文字体族 |

Mermaid 图的 `--pele-*` 变量取自同一组值。切换主题时 Concord 更新沙箱中的变量，不重启 sketch；每帧读取变量的 sketch 下一帧即换色，不读取的 sketch 不受影响。

### 运行环境

sketch 在带 `allow-scripts allow-downloads`、origin 不透明的 iframe 中运行，只能操作自己的文档。

- 与工作台之间的消息按来源窗口与 Schema 验证，只承载启动、绘制暂停、主题色、错误与高度；主题色消息只含上表变量的颜色与字体值。没有读取文件或执行领域操作的消息。
- 运行环境阻断联网、访问父页面 DOM、嵌套 frame、弹窗、表单提交与设备权限，允许本地下载。
- 音频必须由沙箱内的用户手势启动，不开放麦克风权限。

沙箱隔离不等于独立的 CPU 或内存配额。同步死循环与 GPU 耗尽可能让浏览器无响应，宿主不保证能强制中断；超时诊断只说明启动没有完成。只运行可信的 sketch；一般运行错误显示在当前图块中。
