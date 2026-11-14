# 在工作台处理 Issue、Memory 与 Roadmap

## 用户目标

维护者想在浏览器里完成记录的生命周期操作：给 Issue 关联调查用的 Memory 并关闭它，把 Memory 关联到 Spec，把计划中的 Roadmap 采用为 Feature，不必切回终端。

## 起始状态

- `concord view` 正在运行，浏览器打开了它显示的地址。
- 项目里有本地 Issue `docs/issues/checkout-rounding.md`。

## 完整路径

1. 打开 Issue。 {#open}

   点侧栏的「反馈」，内容导航列出 Issue：

   ```text
   反馈
   全部来源   全部处理状态
   checkout-rounding
   待处理 · Local
   ```

   点「checkout-rounding」，再切到「生命周期」页签。

2. 关联调查结论。 {#link}

   预期输出：在「关联 Memory」中填写 Memory 路径，点「关联 Memory」，页面提示「Issue 已关联 Memory。」。这与 `concord issue link` 写入同样的关系。

3. 关闭 Issue。 {#close}

   预期输出：填写「关闭理由」，点「关闭草稿」，页面提示「Issue 已关闭。」，Issue 文件被删除。

   关闭已处理的缺陷时，工作台提交处理结论，按普通关闭操作校验引用与前像后删除 Issue 及对应标记；不执行测试或接收测试通过凭证。验证由 [coding agent](../../local-sdlc/use-case/validate-change-with-project-tools.md) 使用项目工具完成。

4. 处理 Memory 与 Roadmap。 {#other}

   预期输出：Memory 的「生命周期」页签填写 Spec 目标后点「关联 Spec」；状态为 planned 的 Roadmap 可以填写「采用为 Feature ID」后点「采用 Roadmap」。

## 结果

生命周期操作与对应的 CLI 命令执行同一套领域校验，见 [CLI 与 Web 操作对应](../cli.md)。

| 情形 | 看到什么 |
| --- | --- |
| 打开 Roadmap、Design、Memory 或 Issue | 显示「生命周期」页签，只列出当前状态下实际可用的操作 |
| 其它对象收到 `?tab=actions` | 显示元数据页签 |
| 品味 | 没有生命周期表单，直接在「文档」里编辑 `docs/taste.md` |
