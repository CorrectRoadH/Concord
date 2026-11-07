---
relations:
  - role: spec
    target: docs/feature/cross-platform-release/use-case/install-with-script.md#run
---
# 安装器拒绝内嵌 Bun 运行时的归档

## 观察

`install.sh` 在解压后要求 `runtime/node` 可执行。只有 `bin/concord` 编译入口的归档因此报 `The release archive is incomplete.`，无法安装。

## 期望行为

安装器接受携带内嵌 Bun 运行时的归档，校验后激活 `bin/concord`，不要求独立的 JavaScript 解释器。

## 复现

运行 `pnpm gate test/process/install-script.test.ts`。其中首次安装用例通过真实安装脚本安装没有独立 Node 或 Bun 解释器的校验归档，并核对入口与版本输出。
