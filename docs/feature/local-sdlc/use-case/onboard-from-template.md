---
format: concord.document/v1
id: onboard-from-template
title: 接入并取得模板
createdAt: 2026-09-13T11:00:33.375Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 接入并取得模板

## 场景

作为第一次接入 Concord 的仓库维护者，我希望在 Git worktree 顶层一次得到项目配置、写作指南、分类索引和完整参考模板，从而能在不依赖外部 checkout 的前提下开始维护契约。

## 主流程

1. 在尚未存在 `concord.json` 的 worktree 运行 `concord init`，明确测试根与 runner 配置。
2. Concord 先检查全部目标；任何待创建文件冲突都零写入失败。
3. 成功后 `doctor` 报告配置、缺失测试根和当前 case 数量，但不执行 runner。
4. 维护者也可在项目外使用 `template list/show` 查看随包模板。

## 验收

- 已有 `docs/README.md` 不被覆盖，未知 `AGENTS.md` 不被创建或修改。
- 模板 manifest 缺失或库存损坏产生具名错误。
- `init --dry-run` 不创建 Git-private 状态，也不运行配置命令。

## Agent 按需指引

在任意 cwd 使用 `concord --skill` 读取精简的技能入口，用 `concord --skill <topic>` 获取 init、document、test、memory、trace、recovery 或 repository 的完整用法。`concord --skill all` 提供完整离线资料；普通任务只读取相关主题。

技能来自安装包，不加载消费者配置或执行 host。未知主题和与 mutation 混用的参数必须明确失败且不产生写入。


## 纯文档仓库

没有测试的仓库通过 `concord init --docs-only` 接入，配置保存 `testRoots: []`。Feature、Design、Roadmap 与 Engineering 仍可由 AI 使用具名命令维护，doctor 不要求空测试目录，也不建议伪造测试。`--docs-only` 与 `--test-root` 同用必须零写入失败。

文档完整性检查通过只表示当前文档关联有效，不代表测试覆盖。以后有真实测试时在 concord.json 添加测试根，即可恢复发现与关联。
