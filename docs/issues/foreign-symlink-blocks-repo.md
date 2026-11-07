---
relations:
  - role: spec
    target: docs/feature/local-sdlc/architecture.md
---

# 使用者自己的符号链接让整个仓库无法检查

## 现象

在 NiceEval 核心仓库（`/home/ctrdh/Code/NiceEval/NiceEval`，提交 cbe3b1e36）补齐当前格式后运行 `concord --json --dry-run check`，返回 `{"ok":false,"error":"UnsafePath","message":"Symbolic links are not permitted: <root>/.claude/skills/effect-ts"}`，没有任何 finding。`.claude/skills/effect-ts` 是使用者链接到 `../../.agents/skills/effect-ts` 的目录，根目录的 `CLAUDE.md` 也是指向 `AGENTS.md` 的链接；两者都不是 Concord 的 owner。

## 期望

按[路径安全](../feature/local-sdlc/architecture.md#路径安全)：Concord 读写的路径之外的 symlink 不跟随、不读取、不使检查失败；Concord 写入的 skill 目录内与 owner 路径内的 symlink 仍报 `UnsafePath`。先写在临时仓库中放置这两类链接的失败回归，再按 `--fixed` 修复。
