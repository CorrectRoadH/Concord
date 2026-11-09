---
relations:
  - role: supports
    target: docs/feature/herdr-mod/architecture.md#原位预览
---
# Herdr 重绘的 Markdown 解析成本

Herdr 的 `interrupted` 可能来自 QuickJS 的执行期限。检查过的 Herdr 0.1.13 宿主给渲染与布局 50ms，事件与异步任务 500ms；取消 Concord 的内存预算不会改变这个期限。堆栈落在 Markdown 解析器时，应先检查解析发生在哪个宿主回调里，不能仅凭报错认定版本不兼容。

在原生宿主中，把约 35KB 的架构正文放进每次重绘解析可复现中断；提前准备同一正文的 143 个块后，重绘可完成。Bun 中的解析速度不能代表嵌入式 QuickJS，普通替身也不会自动施加宿主的执行期限。

回归可记录真实解析器的调用阶段，断言正文读取、编辑与外部替换都不会使重绘调用解析器，并确认未变正文复用结果。这能稳定验证工作归属；原生 `herdr-app check` 与实际窗口另验证宿主兼容性，不把毫秒阈值塞进普通单元测试，也不把一次文档通过解释为任意规模保证。
