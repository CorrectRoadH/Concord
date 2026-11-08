---
relations:
  - role: spec
    target: docs/feature/local-sdlc/cli.md
---

# `issue close --fixed` 找不到回归测试首次出现的提交

## 现象

不给 `--defect` 时，`concord issue close <id> --fixed` 沿历史寻找回归测试首次出现的提交，在 Concord 仓库里每次都以 `FixUnverifiable: Cannot read <path> in 14cdb30…` 失败，`<path>` 每次不同（`test/support/stop-workspace-server.ts`、`test/domain/herdr-mod-installation.test.ts`、`test/support/operations.ts`）。这些文件在 14cdb30 中存在，在同一环境里逐个 `git show 14cdb30:<path>` 全部成功，机器负载约 1。回归测试实际首次出现在更新的提交 497dd88，给出 `--defect 497dd88` 后不再走这段历史。

复现：在一个回归测试刚提交、修复随后提交的 Issue 上运行 `bun run concord issue close <id> --fixed`。

## 期望

不给 `--defect` 时能找到回归测试首次出现的提交；读取历史文件失败时报告真实原因，而不是把可读的文件报成不可读。
