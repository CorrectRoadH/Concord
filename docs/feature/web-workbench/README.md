# 面向人的项目工作台

`concord view` 在当前 Git 工作区提供 Web 工作台。Web 为维护者提供导航、表单、富文本编辑与结果检查；CLI 为 AI 提供严格输入、明确命令和 JSON 输出。两者使用同一套领域校验。

主侧栏列出 Feature、Roadmap、Design、Engineering、Memory 等分类和「文档」，第二侧栏列出当前分类的条目，右侧预览选中的条目。Use Case 是 Feature 内的 Spec，在所属 Feature 内创建和浏览，从右侧详情抽屉打开。布局、抽屉与移动端行为见[工作台界面](ui.md)。

实现和测试在 Feature / Use Case 详情中展示对应源码位置、声明和运行任务，Feature 汇总自身、支持页面与所属 Use Case 的关联。Memory 单文件条目沿用第二侧栏与右侧正文预览、元数据及生命周期入口。在 Herdr 里使用见 [Herdr mod](../herdr-mod/README.md)。反馈、Git 与设置保留对应工作入口。

Engineering 详情同样提供实现列表、添加关联与源码跳转，汇总主文档和支持页面的实现关联；不因此开放测试 Spec 或测试 tab。实现条目直接展示关联 Spec，不折叠详情，不显示内部查询引用；添加关联无需输入声明 ID。可用宽度充足时将符号、范围及源码位置与关联信息分列，窄内容区使用单列。

## 变更审阅

`concord view` 默认进入 Git 变更，提供全部、文档与测试三个筛选。文件树、区域切换、统一或分栏 diff 以及 URL 选择的行为由[本地未提交变更](use-case/review-local-changes.md)拥有。

`concord view export` 将指定 PR base/head 的差异导出为静态只读页面，消费者负责取得 Git 历史与托管。用户路径见[PR 预览](use-case/review-pull-request.md)，调用与错误见 [CLI 页](cli.md#pr-静态预览导出)，产物见 [PR 预览产物格式](format.md)。

测试筛选列出相对 HEAD 的新增声明及源码位置；声明不等于测试执行。工作台的每个筛选分别记住选中文件和阅读位置，移动端使用内容导航抽屉。项目侧栏与总览使用 worktree 目录名展示。

## 文档阅读与编辑

支持页面从所属 Spec 的文件树进入。「文档」汇总 `docs/` 下尚未归属 Feature、Roadmap、Design、Engineering 或 Issue 的 Markdown，包括架构、品味、概念、索引、指南和 `_template` 参考模板；已有分类入口的 Spec 不在这里重复。点击条目只切换右侧预览。文档页面中的 Markdown 均可编辑，不按文件名、frontmatter 或解析结果设置只读限制；保存规则见[自动保存](ui.md#自动保存)。品味在文档页使用同一原文编辑器。阅读或结构检查不是合规证据。

仓库文件始终是事实来源，关系仍从源码和文档推导，不增加 Web 专属注册表。编辑器与依赖选型见[依赖选型](architecture.md#依赖选型)。

Markdown 支持行内与独立数学公式、Mermaid 结构图与 p5 交互图解。Mermaid 图与 p5 图解共用工作台主题色，切换主题时两者都随之变色；公式渲染时源码与代码字面量保持不变。p5 采用内联代码块或仓库内入口文件，允许自定义动画、模拟、控件、样式和本地扩展；两种入口共用固定版本的完整 p5 核心与独立沙箱。图块在阅读与编辑页面自动启动，普通代码、HTML 和 MDX 不执行脚本。能力与环境边界见[交互图解](use-case/embed-p5-sketch.md)。

## 使用场景

- [使用 Web 工作台](use-case/use-web-workbench.md)
- [查看本地未提交变更](use-case/review-local-changes.md)
- [在 PR 预览中审阅变更](use-case/review-pull-request.md)
- [在 Markdown 中运行 p5 交互图解](use-case/embed-p5-sketch.md)

## 细节

- [工作台界面](ui.md)：布局、导航、自动保存与界面验收。
- [CLI 与 Web 操作对应](cli.md)：启动、工作区投影与 PR 预览导出的命令。
- [工作区 HTTP 接口](api.md)：其它程序读取工作区投影。
- [PR 预览产物格式](format.md)与[库接口](library.md)：静态产物与解码器。
- [性能预算](performance.md)
- [实现](architecture.md)

## 范围

覆盖 Concord 通用模式的正常数据操作。Issue、Memory、Design 与品味的生命周期通过对应操作维护；无法解析的文档 frontmatter 可在原文编辑器修复；配置诊断与文档编辑分别处理。

## 性能

高频操作的性能预算见[面向人的项目工作台的性能预算](performance.md)。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [快到每次都愿意跑](../../taste.md#t-7)
