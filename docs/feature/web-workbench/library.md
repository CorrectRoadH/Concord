# 库与组件

- MDXEditor：Markdown 富文本、源码与编辑差异，使用实际解析错误回退原文。
- react-markdown 与 remark-gfm：审阅和模板的阅读预览，不执行文档中的 HTML/脚本。
- shadcn/ui 与 Radix：侧栏、表单、弹窗、选择器和可访问交互。
- React Router：Feature 内 Use Case 路由及浏览器导航。
- Vite 与 Tailwind：静态构建、样式与开发集成。
- react-diff-view：Git patch 解析及统一、分栏展示。
- Effect：领域执行与外部输入 Schema；严格版本与 CLI 一致。
- Fontsource Noto Sans SC：随安装包提供中文字体，不依赖外部 CDN。

基础行为优先采用库。Concord 自身负责领域关联、能力边界、保存冲突、任务所有权和仓库恢复。

## 浏览器验收环境

`pnpm check` 包含真实 Chromium 的界面验收。开发环境可先运行 `pnpm exec playwright install chromium`；已有浏览器时通过 `CONCORD_BROWSER_PATH` 指定可执行文件。NixOS 本机默认识别 `/run/current-system/sw/bin/chromium`。测试只启动隔离 Git 消费者，不在真实项目内运行示例测试命令。
