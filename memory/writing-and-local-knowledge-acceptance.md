---
format: concord.document/v1
id: writing-and-local-knowledge-acceptance
title: 写作管理与本地知识功能验收
createdAt: 2026-09-23T02:40:35.234Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 写作管理与本地知识功能验收

2026-09-23 在 Concord 工作区完成功能验收，代码尚未提交。Feature、Use Case、Design、constitution amendment 与本记录均通过 Concord 工具维护。写作管理采用 source-owned 方案；独立 Astra 只读挑战的六项条件落实后，由两名 GPT-6 Sol 执行 worker 分别实现写作管理和本地知识入口，父 agent 独立验收并回收。

## 观察结果

- `pnpm check` 最终重跑 230/230 通过，零失败、取消和跳过。第一次全量执行有一项 packed view 测试被取消（219 项通过，错误为 event loop resolved with pending Promise）；单项复跑与完整重跑通过，未确认首次取消的确定原因，不宣称修复了该取消原因。
- 写作专项独立复验 10/10；本地知识打包 CLI 3/3；真实浏览器覆盖写作显式保存、冲突保留、保存后外部写入竞态、无效政策修复和本地 Issue 删除。安全边界包括大小写文件扩展名、首选词冲突、只读 Memory 来源、摘要冲突、关联/历史/远端来源删除拒绝，以及 prepared/committed 恢复。
- `concord check --json` 返回 ok、零 findings；Concord skill 校验通过。
- 独立预升级临时 CLI 对新增写作 journal 的 prepared 和 committed 阶段均以 Not a Concord document owner 拒绝，保留政策字节和 journal。这是一次性兼容性验收，默认测试不依赖该临时安装。

## NiceEval 消费者验收

使用本轮构建并打包、独立安装的公共 CLI，在 `/home/ctrdh/.herdr/worktrees/NiceEval/repot-tool` 临时加载显式迁入的通用政策：130 条手写规则，扫描 972 个文件。CLI 与真实 Web 均报告 199 项既有问题（95 禁词、92 超长句、12 超长段）。这不是全库通过，也没有批量修改这些正文。

真实消费者的临时样例先命中禁词、退出 1，改用推荐写法后退出 0。验收服务结束，政策及样例临时文件全部移除，Git status 保持干净；源 NiceEval checkout 未修改。产物日志与截图保存在 `/tmp/concord-final-accept.HkmpXj`，全量日志在 `/tmp/concord-final-check-retry.log`，它们是本次观察材料，不是持久原生 E2E 证据。

## 边界

Local 与 GitHub、Linear 并列展示，Local 不创建虚假远端 connection，也不进行远端写入。只有没有来源、关系或历史的本地 Issue 草稿可删除；Memory 保留已有生命周期和证据历史。Agent 的工具维护规则不宣称 OS 层禁止用户直接改文件。没有提交、push、发布、付费模型 API 验收调用或生产操作；worker 使用用户指定的 Herdr 模型进程。

最新重新打包的 init 入口已在独立 Git 消费者核验：AGENTS 受管规则、docs/concord.md 工具指引、Feature 示例模板和 docs/README.md 首页都包含声明式契约与工具维护约束。验收临时目录已移除。
