# 面向人的项目工作台

维护者在浏览器里审阅改动、编辑 Spec 与文档、查看实现和测试；AI 用 CLI 的严格输入、明确命令和 JSON 输出做同样的事。`concord view` 在当前项目目录启动这个 Web 工作台，两边执行同一套领域校验，读写的都是仓库里的文件。

## 你可以做什么

- 提交前在「Git 变更」里看清有哪些未提交的改动，可以只看文档或新增的测试声明。
- 在侧栏找到 Feature、Engineering、Roadmap、Design、Memory 与其它项目文档，用富文本或原文直接编辑，停止输入后自动保存。别人同时改了同一个文件时，草稿不会被覆盖。
- 查看一个 Spec 由哪些代码实现、有哪些测试，跳到源码行，为新代码生成关联注释，运行关联的测试。
- 在表单里处理 Issue、Memory 与 Roadmap 的生命周期，在「反馈」里查看各来源的反馈，在「项目设置」里修改配置。
- 在 Markdown 里写数学公式、Mermaid 结构图和会动的 p5 图块。
- 把一个 PR 的变更导出成静态只读页面，交给 CI 托管给审阅者。
- 在 Herdr 里打开工作台，见 [Concord mod](../herdr-mod/README.md)。

## 上手

在已用 `concord init` 初始化的仓库里启动工作台：

```sh
concord view
```

```text
Concord view
Root: /home/me/shop
Host: 127.0.0.1  Port: 4317

  Local:   http://127.0.0.1:4317/
```

打开 `http://127.0.0.1:4317/`，首先看到「Git 变更」。修改 `docs/feature/cart/README.md` 并新增 `test/cart.test.ts` 后，内容导航列出：

```text
Git 变更
全部 2   文档 1   测试用例 1

变更文件 · 2
docs
  feature
    cart
      README.md      M
test
  cart.test.ts       A
```

点 `README.md` 阅读差异，点侧栏的「Feature」再点「cart」打开它的正文，在页面里直接编辑。停止输入后，状态从「等待自动保存…」变为「已自动保存」，改动已写进 worktree 中的文件，回到「Git 变更」就能看到。按 Ctrl-C 停止 `concord view`。

## 怎样工作

主侧栏列出分类与「文档」，[内容导航](concepts.md#content-navigation)列出当前分类的条目，右侧预览选中的条目。Use Case 属于所在的 Feature，在 Feature 内创建和浏览，从右侧的详情抽屉打开。布局、抽屉与手机上的行为见[工作台界面](ui.md)。

仓库文件始终是事实来源。工作台读写的就是 `docs/`、`memory/` 与源码文件，实现与测试的关系从源码和文档推导，不另设 Web 专属的注册表（[一件事只写一次，其余推导](../../taste.md#t-3)）。自动保存只写 worktree 中的文件，不暂存、不提交；摘要只用来防止覆盖并发的外部编辑，见[自动保存](ui.md#自动保存)。阅读与结构检查都不是合规证据（[只声称证明过的](../../taste.md#t-5)）。

### 文档阅读与编辑

附页从所属 Spec 的文件树进入。「文档」汇总 `docs/` 下不属于 Feature、Roadmap、Design、Engineering 或 Issue 的 Markdown，包括架构、品味、概念、索引、指南与 `_template` 参考模板；已有分类入口的 Spec 不在这里重复。点击条目只切换右侧预览。

所有项目 Markdown 都可以编辑，不按文件名、frontmatter 或解析结果设置只读。品味 `docs/taste.md` 也在「文档」里用同一个原文编辑器编辑。

Markdown 支持行内与独立的数学公式、Mermaid 结构图与 [p5 图块](concepts.md#p5-block)。Mermaid 图与 p5 图块使用工作台的主题色，切换主题时一起变色；渲染公式时源码与代码中的字面量保持不变。p5 图块写在内联代码块或仓库内的入口文件里，在阅读与编辑页面自动启动；普通代码块、HTML 与 MDX 不执行脚本。呈现规则见 [Markdown 呈现](ui.md#markdown-呈现)，编辑器与依赖选型见[依赖选型](architecture.md#依赖选型)。

## 用户路径

日常使用：

- [在工作台浏览并编辑项目文档](use-case/use-web-workbench.md)
- [查看本地未提交变更](use-case/review-local-changes.md)
- [在工作台查看 Spec 的实现与测试](use-case/inspect-implementation-and-tests.md)
- [在工作台处理 Issue、Memory 与 Roadmap](use-case/handle-lifecycle-in-workbench.md)

写图解与审阅 PR：

- [在 Markdown 中运行 p5 图块](use-case/embed-p5-sketch.md)
- [在 PR 预览中审阅变更](use-case/review-pull-request.md)

## 细节

- [工作台界面](ui.md)：布局、导航、Markdown 呈现、自动保存、工作区状态与界面验收。
- [CLI 与 Web 操作对应](cli.md)：启动输出、工作区投影与 PR 预览导出的命令。
- [工作区 HTTP 接口](api.md)：其它程序读取工作区投影。
- [文件格式](format.md)：PR 预览产物与 p5 图块；解码器见[库接口](library.md)。
- [实现](architecture.md)

## 范围与验收

工作台覆盖 Concord 通用模式下的正常数据操作。Issue、Memory、Design 与品味的生命周期通过对应的操作维护；frontmatter 无法解析的文档可以在原文编辑器中修复；配置诊断与文档编辑分开处理。

每条用户路径的结果表写明各种情形下看到什么；界面用真实浏览器截图与计算样式验收，见[界面验收](ui.md#验收)。

## 性能

高频操作的性能预算见[面向人的项目工作台的性能预算](performance.md)（[快到每次都愿意跑](../../taste.md#t-7)）。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [快到每次都愿意跑](../../taste.md#t-7)
