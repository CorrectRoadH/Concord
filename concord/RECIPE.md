# Concord

在 coding agent 旁边读写项目 Spec：左侧文档树，右侧 Markdown 正文、关联测试与代码，保存后显示检查结果。

![Concord](preview.png)

## What you see

面板默认在右侧，宽 760px。顶部是 Concord、选择目录、刷新和新建 Feature；下面显示项目路径或错误。左栏宽 220px，按 Feature 与 Use Case、品味、术语、Issue、Memory、其它文档分组；右栏显示正文、测试与实现位置。整体内边距 10px、列间距 10px、正文 13px；背景、文字和错误分别取 Herdr 的 surface、foreground、blocked 主题颜色。

## How it behaves

打开 Concord 命令时聚焦同一 tab 的已有面板，或在当前 pane 右侧分屏；没有 pane 时显示目录选择浮层。缺少 CLI 时只显示安装或升级说明及“重新检测”。较新 CLI 可以使用，并提示用 concord herdr install 更新 mod。选择 Git 仓库后，空项目可初始化并阅读推荐写作指南；文档点击后渲染 Markdown，术语链接显示定义，测试与代码位置可预览。编辑保存后运行检查；文件冲突保留草稿并提供磁盘版本供合并。监听文件变化后刷新，监听不可用时轮询；切换目录和关闭面板时回收任务、监听与编辑器。此面板不显示 agent 的 working、blocked、done、idle 状态，不定义快捷键或悬停动作。

## Built from

mods/concord/main.js 是从源码构建的原生 Herdr View，依赖 gpui-kit、gpui-base 和 herdr，不使用网页视图或内置 mod。mod.json 声明 place=right、size=760、minimumConcordVersion=dev；NOTICE.txt 保留捆绑依赖许可证。View 使用 v_flex、h_flex、TextView、Editor、Input；props.cwd 指定项目目录，props.overlay 标识打开命令的浮层。通过 focused、panes、spaces 确定目录，调用 pane.focus、pane.split、closeOverlay 管理面板，使用 pickFolder、watchFolder、readTextFile、writeTextFile、appHome、theme。exec 运行 concord --version 和公开 CLI 查询及写入命令，包括 --json doctor、init、list、show、concepts index、taste、check、new feature 以及 --skill。截图来自 src/entry/herdr-mod/preview.png，是在真实 Herdr 主机上截取的界面，不生成占位图。

## Watch out

先读 Herdr 配置目录的 AGENTS.md 和所有 mod 文件，向用户说明会运行 concord 并读写当前项目文件；mod 自身不发网络请求。需要 PATH 上的 Concord（使用最新发布版本），安装命令为 curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh；Homebrew 与 Nix 安装方式见 Concord README。读取 src/entry/herdr-mod/ 来重建，使用固定 Bun 工具链运行 bun run build:herdr，保留原生 Herdr 导入和 NOTICE。只复制 mods/concord/ 到用户 mods 目录，名称冲突时按 Herdr 指南调整；不复制本说明和预览，不修改布局或快捷键。没有 Git 目录时先选择目录。p5 动画通过“在浏览器中播放”打开，面板只显示说明与源码。

## Done when

对复制后的目录运行 herdr-app check；打开 Concord，核对右侧面板及目录选择；验证未安装或过旧 CLI 时的提示、重新检测、空 Git 仓库初始化及指南、文档与关联测试和代码的阅读、编辑保存与检查、外部文件变化刷新及冲突草稿保留。用 herdr-app shot 在真实主机截图并实际查看。卸载只删除该 mod 目录，用户布局和快捷键保持原样。
