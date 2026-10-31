# Herdr mod 的实现

mod 是随 Concord 包发布的一组 JavaScript 文件：`main.js` 默认导出一个继承 `View` 的类，`mod.json` 声明 `"place": "right"`。它按 Herdr 的 mod 接口绘制原生界面，不包含 HTML、CSS 或网页视图。

接口依据是 herdr-app 的 [mod 指引](https://raw.githubusercontent.com/herdrdev/herdr-app/refs/heads/master/defaults/AGENTS.md)，以及运行中的 Herdr 每次启动时生成的 `herdr.d.ts` 与 `gpui-kit.d.ts`。本页用到的接口：`View` 的 `init`、`render`、`close`；`exec`、`readTextFile`、`writeTextFile`、`watchFolder`、`pickFolder`；`TextView.markdown`、`EditorState` 与 `Editor`。真实主机上的验收用 `herdr-app check <mod 目录>` 加载 mod，用 `herdr-app shot` 截图核对界面。

## 数据

- 目录：取当前聚焦 pane 的工作目录；用户也可以用 `pickFolder()` 选另一个目录。
- 读取：用 `exec('concord', ['--json', ...], { cwd })` 调用[mod 调用的命令](cli.md#mod-调用的命令)，用 `readTextFile` 读正文。mod 不缓存结论，每次刷新重新取。
- 写入：保存时用 `writeTextFile` 写回文件，写入前比较读取时的文件摘要，已被别人改过就提示冲突、保留草稿，不覆盖。写入后运行 `concord --json check` 显示结果。
- 刷新：`watchFolder` 监听仓库目录，变化合并 200ms 后重新取数据；当前打开的文档、滚动位置与草稿保持不变。

## 界面

- 左栏是文档树，按 Feature、品味、术语、Issue、Memory、其它文档分组；右侧是正文。
- 正文用 `TextView.markdown` 渲染；编辑用 `EditorState` 与 `Editor`。
- Use Case 正文下方列出守护它的测试与实现它的代码，按步骤分组；点击跳到对应文件位置。
- p5 代码块显示 `p.describe` 的文字说明与源码，以及“在浏览器中播放”按钮：mod 让 Concord 把这一个图解导出为本地 HTML 文件，再用系统浏览器打开。

## 安装

`concord herdr install` 复制随包的 mod 目录，不修改 Herdr 的其它 mod、布局或快捷键。随包 mod 通过 `herdr-app check` 校验。
