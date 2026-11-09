---
relations:
  - role: spec
    target: docs/feature/herdr-mod/use-case/use-on-remote-machine.md
---
# Herdr 未识别 CLI 的未知选项错误

旧版 CLI 不支持 `server status --wait` 时返回 `InvalidInput` 与 `Unrecognized flag: --wait`。mod 将它显示为普通命令错误，没有进入声明的升级提示。

预期：不认识命令或选项都显示目标机器的升级请求，并使该机器的 CLI 检测结果失效。命令边界返回上述响应即可复现。
