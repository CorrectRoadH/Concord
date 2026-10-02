---
format: concord.document/v1
id: web-workbench
title: 面向人的项目工作台
createdAt: 2026-09-14T00:00:00.000Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-012
  - docs/constitution.md#c-013
  - docs/constitution.md#c-014
---

# 面向人的项目工作台

`concord view` 在当前 Git 工作区提供 Web 工作台。Web 为维护者提供导航、表单、富文本编辑与结果检查；CLI 为 AI 提供严格输入、明确命令和 JSON 输出。两者使用同一套领域校验。

主侧栏显示 Feature、Roadmap、Design、Research、Engineering、Memory 等分类入口，以及「文档」。独立的第二侧栏始终显示当前分类的完整条目列表及筛选输入；点击条目只切换右侧预览，列表不会消失。分类入口默认预览第一项，空集合提供创建入口，不重复展示卡片网格。

支持页面与 Use Case 在右侧预览内访问，移动端通过单独的内容导航抽屉访问条目列表。点击 Use Case 时保留 Feature 背景，并从右侧打开详情抽屉；深链接和刷新仍打开该抽屉。关闭或返回时先完成待保存内容，只有自动保存失败时才要求处理草稿。Use Case 是 Feature 内的契约，必须在所属 Feature 内创建和浏览，没有独立顶级入口。

实现和测试在 Feature / Use Case 详情中展示对应源码位置、声明和运行任务，Feature 汇总自身、支持页面与所属 Use Case 的关联。Memory 单文件条目沿用第二侧栏与右侧正文预览、元数据及生命周期入口。执行收据从「诊断与工具」访问，保留直接链接。反馈、Git 与设置保留对应工作入口。

Engineering 详情同样提供实现列表、添加关联与源码跳转，汇总主文档和支持页面的实现关联；不因此开放测试契约或测试 tab。实现条目直接展示关联契约，不折叠详情，不显示内部查询引用；添加关联无需输入声明 ID。可用宽度充足时将符号、范围及源码位置与关联信息分列，窄内容区使用单列。

## 变更审阅

`concord view` 默认进入 Git 变更，提供全部、文档与测试三个筛选。文件树、区域切换、统一或分栏 diff 以及 URL 选择的行为由[本地未提交变更](use-case/review-local-changes.md)拥有。

`concord view export` 将指定 PR base/head 的差异导出为静态只读页面，消费者负责取得 Git 历史与托管。比较基线、阅读边界和验收由[PR 预览](use-case/review-pull-request.md)拥有，结构与资源生命周期见[变更预览方案](change-preview.md)。

测试筛选列出相对 HEAD 的新增声明及源码位置；声明不等于测试执行。工作台的每个筛选分别记住选中文件和阅读位置，移动端使用内容导航抽屉。项目侧栏与总览使用目录名展示，projectId 保留在配置与诊断中。

## 文档阅读与编辑

支持页面从所属契约的文件树进入。「文档」汇总 `docs/` 下尚未归属 Feature、Roadmap、Design、Research、Engineering、Issue 或 Memory 来源的 Markdown，包括架构、宪法、概念、索引、指南和 `_template` 参考模板；已有分类入口的契约不在这里重复。点击条目只切换右侧预览。文档页面中的 Markdown 均可编辑，不按文件名、frontmatter 或解析结果设置只读限制；普通原文保存使用完整文件摘要保护。宪法在文档页使用同一原文编辑器。阅读或结构检查不是合规证据。

正文使用 MDXEditor，基础交互使用 shadcn/ui。React Router 管理地址与导航，Vite 构建静态资源并随 CLI 包分发。仓库文件始终是事实来源，关系仍从源码和文档推导，不增加 Web 专属注册表。

Markdown 支持 Mermaid 结构图与 p5 交互图解。p5 采用内联代码块或仓库内入口文件，允许自定义动画、模拟、控件、样式和本地扩展；两种入口共用固定版本的完整 p5 核心与独立沙箱。图块在阅读与编辑页面自动启动，普通代码、HTML 和 MDX 不执行脚本。能力与环境边界见[交互图解](use-case/embed-p5-sketch.md)。

## 使用场景

- [使用 Web 工作台](use-case/use-web-workbench.md)
- [查看本地未提交变更](use-case/review-local-changes.md)
- [在 PR 预览中审阅变更](use-case/review-pull-request.md)
- [在 Markdown 中运行 p5 交互图解](use-case/embed-p5-sketch.md)

## 范围

覆盖 Concord 通用模式的正常数据操作。Memory 历史、证据与身份字段通过受管操作维护；无法解析的文档 frontmatter 可在原文编辑器修复；配置诊断与文档编辑分别处理。高级原生执行由项目明确接入，静态测试投影不要求执行器或通道字段。


## Web 组件组合

通用组件只负责展示：`ContentSidebar` 统一桌面侧栏与移动抽屉，`DetailDrawer` 统一右侧详情，`RecordList`、`RecordLink` 与 `PanelEmpty` 统一记录和空状态。领域页面负责查询数据、生成导航模型、解释 URL 和关闭行为；通用组件不读取 Workspace，也不识别 Feature 或 Use Case。视觉层级、版式和组件选用规则见根目录 [DESIGN.md](../../../DESIGN.md)，URL 与草稿保护见[工作台架构](architecture.md#url-与导航状态)。

文档、写作、术语、反馈与 Git 复用同一个内容导航。反馈的第一入口是反馈条目，Git 的第一入口是变更文件。写作与术语先选择适用范围，再显示该范围的规则或术语；主导航不藏进设置折叠项或额外管理入口。

Git 页由 `GitPage` 组合页头、分类 tab、桌面双栏和移动文件导航。`useGitReview` 拥有 URL 选择、tab 内选择、阅读位置记忆及 diff 请求；`model` 派生目录树和暂存区域；`FileTree` 呈现可折叠树和测试声明入口；`DiffReading` 呈现并恢复 diff 阅读位置。差异阅读区样式由本地 StyleX 定义，第三方 diff 基础样式由库提供。`data-git-diff` 与 `data-testid="git-diff-scroll"` 是浏览器回归的稳定定位点。

## 自动保存

正文、源码、作者字段和项目设置共用 `useAutoSave`：停止输入 800ms 后保存，同一编辑器的请求串行执行；请求期间的新输入留给下一次保存。切换预览、页签、文件或关闭详情抽屉前主动 flush。写入继续使用后端整文件摘要保护，冲突保留草稿并展示差异，不覆盖外部编辑。创建、运行测试和生命周期裁决仍是显式操作。自动保存写入 Git 工作树，不执行暂存、提交或 push。

## 请求性能预算

独立客户端与服务进程在冻结的 1112 个源码文件、110 个支持页面消费者上测量 workspace 与并发 jobs、file、document.set。原生产物正常与摘要不匹配回源分别采样；预热一次，同机交错运行至少七对，记录请求全程 p50、最大值及服务阶段。相对指定测前基线，各路由 p50 回退不得超过 20%，最大值超过本组 p50 两倍时重测，连续两组无效判失败。基线、机器、Node、消费者 commit 与产物摘要随测量记录进入 Memory；诊断阈值不是 HTTP 响应 SLA。测量脚本为 `scripts/measure-view-requests.ts`，document.set 使用相同正文与真实前像摘要，结束后消费者内容保持不变。
