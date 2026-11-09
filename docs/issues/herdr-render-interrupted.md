---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/read-spec.md#open-feature
---
# Herdr 阅读长篇正文时重绘被中断

## 观察

在 macOS Herdr 打开 `docs/feature/local-sdlc/architecture.md` 时，视图报告 `This view could not be re-rendered` 与 `interrupted`，保留“正在读取文档”的上一帧。堆栈落在 mod 捆绑的 Markdown 解析器。正文每次重绘都同步解析，触及 Herdr 的渲染执行期限。

## 期望

首次读取准备正文分块；重绘复用分块，长篇正文完整显示。编辑、保存、外部更新与换页后的分块对应各自原文。

## 复现

`bun run gate test/model/herdr-mod-host.test.ts --test-name-pattern='source mod obeys'`。回归记录真实解析器的调用阶段，验证打开长篇文档、重绘、编辑与刷新时不在重绘中解析正文。
