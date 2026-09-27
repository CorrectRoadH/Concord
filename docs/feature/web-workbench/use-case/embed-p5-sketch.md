---
format: concord.document/v1
id: embed-p5-sketch
title: 在 Markdown 中运行 p5 交互图解
createdAt: 2026-09-27T00:00:00.000Z
kind: use-case
feature: docs/feature/web-workbench/README.md
---

# 在 Markdown 中运行 p5 交互图解

维护者用 Mermaid 描述结构，用 p5 sketch 展示动画、模拟和可操作的解释。Markdown 的阅读与编辑入口使用相同的 p5 运行环境。普通代码块只展示源码，HTML 和 MDX 不执行脚本。

## 流程动画的默认表达

架构讲解推荐使用自动循环的流程动作：按顺序突出当前阶段，沿连线展示事实或控制的传递，完成后短暂停留，再回到起点。每轮只解释一个过程，阶段名称和简短说明跟随动画，读者无需操作即可看完。

默认直接用 `p.draw` 驱动流程，不额外添加播放、暂停、上一步、下一步或重置控制器。只有需要读者调整参数、操作模拟时才加入交互控件；这是表达建议，不限制 p5 API。视口与页面隐藏的绘制暂停由 Concord 管理。按绘制时间累计进度时限制单帧时间增量，避免恢复可见后突然跳过多个阶段。

动画只解释契约声明的过程，不把演示中的成功状态当成实际执行或验收证据。静态归属、目录结构和无需时间顺序的关系仍适合静态图。

## 内联与文件引用

小型图解直接写在 `p5` 围栏内。默认实例模式提供带 p5 类型的 `p`，支持辅助函数、状态、类和 p5 2.3.4 的完整核心 API。

````markdown
```p5
const stages = ['读取事实', '验证关系', '生成视图'];
let elapsed = 0;
p.setup = () => {
  p.createCanvas(540, 160);
  p.describe('读取事实、验证关系、生成视图按顺序自动循环');
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(16);
};
p.draw = () => {
  elapsed = (elapsed + Math.min(p.deltaTime, 100)) % 6000;
  const step = Math.floor(elapsed / 2000);
  p.background(245);
  stages.forEach((label, i) => {
    p.fill(i === step ? '#d8eee7' : '#ffffff');
    p.rect(20 + i * 180, 45, 140, 60, 8);
    p.fill('#203b33');
    p.text(label, 90 + i * 180, 75);
  });
};
```
````

内联正文也可以写成包含 `export default function (p: P5) { … }` 的完整 TypeScript 模块，类型通过 `import type P5 from 'p5'` 引入。外部实例模式入口必须默认导出实例函数，源码只由外部文件拥有；引用块正文必须为空。

````markdown
```p5 src="./queue/main.ts" css="./queue/style.css"
```
````

`src` 与 `css` 相对 Markdown 文件解析。入口支持 `.ts`、`.js` 和 `.mjs`；模块内部相对引用以当前模块为基准。入口及其依赖必须位于当前 Git 仓库内，不允许 symlink、隐藏目录、隐藏文件或 `node_modules`。模块导入使用相对路径，`p5` 类型与运行库由 Concord 提供；工具不运行消费者的构建配置或安装脚本。

外部实例模式入口使用同样的默认导出函数。需要读者操作的交互式模拟也可以创建控件，下面展示这种交互例外；流程讲解仍默认自动循环。

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

`mode="global"` 支持内联或外部入口中的顶层生命周期和事件函数声明，例如 `function setup()`、`function draw()`。全局模式不要求默认导出。每个图块拥有独立全局对象。p5 2.x 的异步资源在 `async setup()` 中等待，不承诺所有 p5 1.x 程序原样兼容。

## 样式、资源与扩展

sketch 可以创建自己的画布、DOM 控件与容器，使用 p5 元素样式 API 或 CSS 完成布局、伪类、媒体查询和动画。CSS 只影响当前沙箱，不影响工作台。画布内部的图形样式由 p5 绘图 API 控制。

受支持的图片、字体、音视频及 STL 文件通过相对模块导入得到内嵌资源 URL；JSON 导入为数据，文本、OBJ 与 shader 文件导入为字符串。CSS 的相对 `url()` 资源随图解打包。`loadImage('./image.png')` 这样的运行时字符串不触发仓库文件读取；作者应导入资源 URL 后交给对应 p5 API。WebGL 由 p5 核心提供。

默认加载固定版本的 p5 核心。库依赖由项目的 `concord.config.ts` 统一声明；Markdown 不声明或覆盖库集合。所有 sketch 在自己的沙箱内按项目声明顺序加载同一组库。未知名称返回诊断，不联网下载或自动安装。扩展版本与兼容范围由[库与组件](../library.md)拥有。

```ts
p5: {
  libraries: ['p5.sound', 'p5.brush', './vendor/addon.js'],
},
```

`p5.libraries` 最多包含 16 个不重复条目。内建名称对应随 Concord 固定的版本，自定义 `.js` 路径相对项目根解析。没有配置或列表为空时只加载 p5 核心。设置继续通过现有配置更新与前像校验维护，不增加独立依赖登记文件。

作者可以通过相对模块导入自己的 JS／TS 逻辑及资源。传统扩展浏览器脚本由项目配置选择，在 sketch 前按声明顺序加载；模块逻辑通过相对 `import` 引入。扩展与 sketch 使用同一沙箱和资源预算，不获得工作台权限。Concord 不提供任意 npm 包解析、远程 CDN 或通用前端项目入口；第三方扩展的注册形式、类型声明和 p5 版本兼容性由项目作者核对。`p5.collide2d` 因 NC 许可不作为内建扩展，其它扩展也不声明为已验证兼容。

## 执行与生命周期

1. 阅读和编辑页面自动加载并启动 p5 图块，像动画图片一样直接展示，不要求点击编译或播放。正常展示不附加运行工具栏；失败时显示诊断与重试入口。
2. TypeScript 输入接受严格类型检查；`.js` 与 `.mjs` 是合法的消费者 sketch 输入。语法、类型、路径、依赖或预算失败显示具名诊断，保留原文。JavaScript 输入不作为 Concord 实现代码的语言例外。
3. 暂停只控制 p5 绘制循环；继续保持 sketch 自身的 `noLoop()` 意图。画布滚出视口或页面隐藏时暂停绘制。作者自行管理额外实例和非绘制计时器。
4. 修改源码或选项、切换文档时销毁沙箱；编辑短暂防抖后自动加载最新输入。重新打开或刷新文档时重新读取外部依赖。
5. 自动加载、展开源码、重试、下载和主题变化不保存 Markdown。显式源码或选项编辑继续使用工作台自动保存与摘要冲突保护。外部引用不复制源文件内容，不增加写入口。

sketch 在 `allow-scripts allow-downloads` 且具有 opaque origin 的 iframe 内运行，只能操作自己的文档。消息按来源窗口与 Schema 验证，仅承载启动、绘制暂停、错误和高度；不提供文件读取或领域操作桥接。运行环境阻断联网、父 DOM 访问、嵌套 frame、弹窗、表单提交及设备权限，允许本地下载。音频播放须由沙箱内用户手势启动，麦克风权限不开放。

沙箱隔离不代表独立 CPU 或内存配额。同步死循环和 GPU 耗尽可能使浏览器无响应，不能声称宿主必定能够强制中断；超时诊断只说明启动未完成。需运行可信的 sketch；一般运行错误在当前图块展示。

## 验收

- 内联实例模式、完整默认导出模块、全局模式和外部多文件入口可执行；2D、WebGL、DOM 控件、事件、CSS 和本地资源有真实 Chromium 观察。
- 编辑和只读页面均识别 p5 块及选项，未知普通代码块仍为源码，Mermaid 行为保留。加载与运行不改写 Markdown 字节。
- 自动启动、视口暂停与恢复、多实例隔离、修改和离页清理有可观察结果；保持 sketch 的 noLoop 意图，语法和类型错误不得替换为成功画布。
- 源码、扩展与 CSS 依赖拒绝越界、symlink、隐藏路径、未知扩展库及远程 import；编译不执行作者代码。最终核对读取集合中的文件字节，变化返回 `P5SourceChanged`。
- 每次编译最多观察 128 个路径，输入合计不超过 8 MiB，单块内联正文不超过 256 KiB，编译输出不超过 16 MiB。失败不留下文件、持久句柄或仓库租约；Web 首屏不加载 p5 运行库。
- 运行时和内建扩展随安装包离线可用。通过打包后的公开 CLI 启动隔离 Git 消费者，验证动画、扩展与安全边界，不依赖开发仓库的全局安装。
