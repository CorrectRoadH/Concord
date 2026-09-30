---
format: concord.document/v1
id: pr-change-preview-review
title: PR 变更预览设计审查阻塞
createdAt: 2026-09-30T02:25:14.052Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

## 设计收敛

最初原生 Claude 审查受 HTTP 402 阻塞。用户随后明确要求两个功能及 NiceEval 接入都继续，并指定 GPT-6 Astra 审查。通过 Herdr 运行的首次审查指出输出所有权、Git 隔离、Schema、PR 身份及预算五组问题；主 agent 修订后，第二次独立审查通过。相关 pane 均已关闭。

采用的契约见 [静态比较设计](../docs/design/pr-change-preview/plans/static/architecture.md)。本地默认页展示全部未提交变更；静态导出只比较冻结提交的唯一共同祖先到 head。NiceEval 负责查询实际 PR 目标及 head、获取 Git 历史、重新核对身份与托管；不固定 main。

## 实现与验收

已实现 view export、共享严格 Schema、独立静态浏览器，以及 NiceEval 安装包依赖和 Preview contribution 接入。静态导出在禁止 Node 原生 addons 时通过真实安装包测试；特殊路径、对象模式、replace refs、shallow、输出冲突、对象预算和取消回收均走公开 CLI 验证。

本地页与 PR 导出针对性测试四项通过。selfhost 与 view-server 九项复测通过。NiceEval 正式 preview changes 在隔离 Git 消费者通过；完整 preview:build --local 加显式比较通过，浏览器在实际 Netlify CSP 下验证入口、子路径、选择和刷新。构建收据排序不符 Schema 的问题已修正并重验。

最终 Concord 完整 pnpm check 为 335 通过、3 失败、2 跳过；失败是 GitHub 设置、p5 浏览器及 storage 的断言。本次本地工作台、PR 导出、selfhost 与工作区浏览器测试均通过。完整门禁仍未通过，不将针对性通过称作全量通过。NiceEval repo-tools 类型检查通过；最新全量 lint 被本任务未修改的 contextual-material 文档长段落阻断。

远端 PR 与 Netlify 部署尚未验收；没有执行 push、发布或部署。固定 vendor tarball 由正式 build/pack 生成，避免 CI 依赖本地相邻源码。命令成功与静态浏览器验证不证明 NiceEval 模型执行或线上部署可靠性。

NiceEval 接入提交为 ebdfa4d71。最终站点包含 108 个受检静态文件，中文字体随包提供；浏览器验收通过后已移除临时站点、私有 Function 和验收脚本。
