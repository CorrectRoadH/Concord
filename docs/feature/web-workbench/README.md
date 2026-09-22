---
format: concord.document/v1
id: web-workbench
title: 面向人的项目工作台
createdAt: 2026-09-14T00:00:00.000Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
---

# 面向人的项目工作台

`concord view` 在当前 Git 工作区提供 Web 工作台。Web 为维护者提供导航、表单、富文本编辑与结果检查；CLI 为 AI 提供严格输入、明确命令和 JSON 输出。两者使用同一套领域校验。

主侧栏显示 Feature、Roadmap、Design、Research、Engineering 等分类入口，以及「文档」。独立的第二侧栏始终显示当前分类的完整条目列表及筛选输入；点击条目只切换右侧预览，列表不会消失。分类入口默认预览第一项，空集合提供创建入口，不重复展示卡片网格。支持页面与 Use Case 在右侧预览内访问，移动端通过单独的内容导航抽屉访问条目列表。点击 Use Case 时保留 Feature 背景，并从右侧打开详情抽屉；深链接和刷新仍打开该抽屉，关闭或返回时先完成待保存内容，只有自动保存失败时才要求处理草稿。Use Case 是 Feature 内的契约，必须在所属 Feature 内创建和浏览，没有独立顶级入口。实现和测试在 Feature / Use Case 详情中展示对应源码位置、声明和运行任务，Feature 汇总自身、支持页面与所属 Use Case 的关联。运行证据、Memory、反馈、Git 与设置保留对应工作入口。

Engineering 详情同样提供实现列表、添加关联与源码跳转，汇总主文档和支持页面的实现关联；不因此开放测试契约或测试 tab。实现条目直接展示关联契约，不再折叠详情或显示内部查询引用；添加关联无需输入声明 ID。可用宽度充足时将符号、范围及源码位置与关联信息分列，窄内容区使用单列。

Git 页默认显示 Docs 变更 tab，第二个 tab 显示测试用例相关文件变更。测试文件由配置的 testRoots 和当前测试声明所在文件识别，同时考虑重命名前路径。桌面采用常驻双栏：左侧按目录组织可折叠文件树，每个文件只出现一次并显示变更状态；右侧直接呈现选中文件的 Git diff，默认选择树中第一个文件。暂存、未暂存与未跟踪区域及统一/分栏布局在右侧顶部切换。

两个 tab 在当前页面内分别记住选中文件与各文件差异的阅读位置；深链接与刷新保留显式选中文件，文件已无变更时选择仍可用的文件。新增测试声明挂在所属文件下，点击定位当前文件行号对应的 diff 行；行不在当前差异中时保留文件预览并说明位置。移动端通过可展开的文件导航选择文件，diff 保持在页面内，不使用详情抽屉。

测试 tab 按 HEAD 中 AST 解析的稳定 case ID 对比当前声明，列出新增测试及其契约和源码位置。文件变更不等于用例级语义差异，新增声明不等于测试已经执行。项目侧栏与总览使用目录名展示，projectId 保留在配置与诊断中。

支持页面从所属契约的文件树进入。「文档」汇总 `docs/` 下尚未归属 Feature、Roadmap、Design、Research、Engineering、Issue 或 Memory 来源的 Markdown，包括架构、宪法、概念、索引、指南和 `_template` 参考模板；已有分类入口的契约不在这里重复。点击条目只切换右侧预览。宪法以及存储层未授权改写的文件只读；已授权且没有 frontmatter 的项目文档沿用支持页面的摘要保护编辑。阅读或结构检查不是合规证据。

正文使用 MDXEditor，基础交互使用 shadcn/ui。React Router 管理地址与导航，Vite 构建静态资源并随 CLI 包分发。仓库文件始终是事实来源，关系仍从源码和文档推导，不增加 Web 专属注册表。

## 使用场景

- [使用 Web 工作台](use-case/use-web-workbench.md)

## 范围

覆盖 Concord 通用模式的正常数据操作。Memory 历史、证据与身份字段通过受管操作维护；损坏且无法认证的配置或 frontmatter 只读诊断，需本机修复。高级原生执行由项目明确接入，静态测试投影不要求执行器或通道字段。


## Web 组件组合

`ContentSidebar` 接收页面提供的标题、返回链接、分组和条目模型，统一桌面侧栏与移动抽屉。`DetailDrawer` 接收标题、说明、受控开关与内容插槽，统一右侧详情布局。领域页面负责查询数据、生成导航模型、解释 URL 和关闭行为；这些通用组件不读取 Workspace，也不识别 Feature 或 Use Case。正文与表单继续由各页面组合，路由草稿确认复用工作区已有机制。

Git 页由 `GitPage` 组合页头、分类 tab、桌面双栏和移动文件导航；`useGitReview` 拥有 URL 选择、tab 内选择/阅读位置记忆及 diff 请求，`model` 派生目录树和暂存区域，`FileTree` 只呈现可折叠树和测试声明入口，`DiffReading` 只呈现并恢复 diff 阅读位置。上述 Git 布局样式由各组件本地 StyleX 定义，`styles.css` 保留全局主题、基础及其它页面样式，不再存放 Git 专用规则；第三方 diff 基础样式继续由库提供。`data-git-diff` 与 `data-testid="git-diff-scroll"` 是浏览器回归的稳定定位点。


正文、源码、作者字段和项目设置共用 `useAutoSave`：停止输入 800ms 后保存，同一编辑器的请求串行执行；请求期间的新输入留给下一次保存。切换预览、页签、文件或关闭详情抽屉前主动 flush。写入继续使用后端整文件摘要保护，冲突保留草稿并展示差异，不覆盖外部编辑。创建、运行测试和生命周期裁决仍是显式操作。自动保存写入 Git 工作树，不执行暂存、提交或 push。
