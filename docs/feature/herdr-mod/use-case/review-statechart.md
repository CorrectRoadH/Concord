# 审阅状态图

## 用户目标

维护者让 agent 用模型检查器核查一段并发或恢复逻辑。agent 交回 statechart 页后，维护者想在 Herdr 里看清模型会经过哪些状态、哪些状态打破了规则、坏状态是怎么走到的，判断哪些是真问题，再把结论交还 agent。

## 起始状态

- 仓库已初始化，Feature `state` 有 statechart 页 `docs/feature/state/statechart.md`。页面写了规则“回调最多执行一次 {#AtMostOnce}”，并有一个[状态图块](../../local-sdlc/format.md#状态图块)，引用 `tla/Recovery.tla`、`tla/fixed.cfg`、view 模块与输出目录 `tla/out/fixed`。
- 输出目录是 agent 用模型检查器生成的，有 `chart.mmd` 与 `report.md`；`digest` 与当前模型一致。

## 完整路径

1. 在文档列表里点 Feature `state` 下的 statechart 页。 {#open-statechart}

   正文先显示规则与模型范围；状态图块位置显示“正在渲染图表…”，渲染完成后显示模型与配置的路径、状态图与检查报告，见[页面视图](../ui.md#页面视图)。打破 `AtMostOnce` 的状态实线描边。

2. 读检查报告里 `AtMostOnce` 的最短路径。 {#read-path}

   报告按步编号列出从起点到坏状态的每一步与每一步之后的状态。维护者对照页面上的动作与代码映射表，判断这条路径在真实代码里能不能发生。

3. 点状态图块里的模型路径。 {#open-model}

   正文下方打开 `Recovery.tla` 的只读源码，可以核对规则在模型里的写法。

4. 右键状态图块，点“复制讨论 Prompt”。 {#discuss-statechart}

   剪贴板得到机器、仓库、页面与模型文件的路径，以及请 agent 逐条说明坏状态的要求。维护者把它发给 agent，并写下自己的判断，例如“`AtMostOnce` 的路径是真问题，请写回归测试并修复”。

5. agent 修改模型后，查看过期提示并请它重新生成。 {#regenerate}

   agent 改了 `Recovery.tla` 但没有重新生成输出目录。页面自动刷新，状态图块显示“模型在这份结果之后改过，状态图已过期”，路径行下的检查摘要包含 `StatechartStale`。右键点“复制重新生成请求”交给 agent；agent 重新运行模型检查器、替换输出目录并更新 `digest` 后，提示与 finding 一起消失。

## 结果

不离开 Herdr 就能读完状态图与检查报告，并把审阅结论交给 agent。状态图只说明模型；代码是否符合模型，看重放坏状态路径的测试，测试用 `@spec` 指向被打破的规则。

| 情况 | mod 显示 |
| --- | --- |
| 模型超出图的规模上限，输出目录没有 `chart.mmd` | 只显示模型路径与检查报告 |
| `digest` 与当前模型不同 | 过期提示，状态图与报告照常显示；`check` 报告 `StatechartStale` |
| 输出目录没有 `report.md`、模型文件缺失或块写错 | 块内显示原因与块源码，可点击修正；`check` 报告对应的[状态图 finding](../../documentation-quality/cli.md#状态图) |
| 状态图块写在 statechart 页以外 | 块内显示位置错误；`check` 报告 `InvalidStatechartPosition` |
