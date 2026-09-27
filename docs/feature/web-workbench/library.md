# 库与组件

- MDXEditor：Markdown 富文本、源码与编辑差异，使用实际解析错误回退原文。
- react-markdown 与 remark-gfm：审阅和模板的阅读预览，不执行文档中的 HTML/脚本。
- shadcn/ui 与 Radix：侧栏、表单、弹窗、选择器和可访问交互。
- React Router：Feature 内 Use Case 路由及浏览器导航。
- Vite 与 Tailwind：静态构建、样式与开发集成。
- react-diff-view：Git patch 解析及统一、分栏展示。
- Effect：领域执行与外部输入 Schema；严格版本与 CLI 一致。
- Fontsource Noto Sans SC：随安装包提供中文字体，不依赖外部 CDN。
- p5.js 2.3.4：完整核心运行库，仅在运行图解时加载，支持实例与全局模式。
- p5.sound 0.4.1：显式声明后离线加载，提供声音播放、合成和分析；音频启动仍要求沙箱内的用户手势，麦克风权限不开放。
- p5.brush 2.2.3：显式声明后离线加载，提供笔刷、自然填充和排线；按扩展要求使用 WebGL 画布。项目启用后每个图块都会加载该库，包含不调用笔刷 API 的图块，作者须统一满足它的画布要求。
- TypeScript 与 esbuild 0.28.2：检查并编译 p5 输入，不执行消费者构建配置或安装脚本。第三方库的 JS 产物与许可证由固定依赖随包提供。

基础行为优先采用库。Concord 自身负责领域关联、能力边界、保存冲突、任务所有权和仓库恢复。

## 浏览器验收环境

`pnpm check` 包含真实 Chromium 的界面验收。开发环境可先运行 `pnpm exec playwright install chromium`；已有浏览器时通过 `CONCORD_BROWSER_PATH` 指定可执行文件。NixOS 本机默认识别 `/run/current-system/sw/bin/chromium`。测试只启动隔离 Git 消费者，不在真实项目内运行示例测试命令。
