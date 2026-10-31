---
status: open
---

# 并行写入时 check --since 以 PreimageChanged 失败

## 现象

多个 agent 在同一 checkout 并行开发时，`concord check --since <base>` 读取工作树期间其它 agent 写入文件，命令以 `PreimageChanged: Target worktree changed during endpoint checks` 退出 1；关系与写作子检查本身通过。交付前的检查因此只能等工作树停稳后重跑，且结果包含他人尚未提交的改动。

## 待决

是否为 `check --since` 提供以已提交快照为目标的方式，例如以某个提交为目标、从 Git 对象读取来源。这样交付者检查的是自己已提交的变化，不受他人未提交改动影响。目标为工作树时的现行语义不变（[检查本次变化](../feature/local-sdlc/cli.md#检查本次变化)）。修复核验已采用临时检出隔离（[修复缺陷](../feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed)）。
