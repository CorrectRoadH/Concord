---
relations:
  - role: adopts
    target: docs/feature/local-sdlc/cli.md
---

# 原生用例与依赖项的人读输出显示 undefined

## 现象

`concord test discover`、`concord code analyze` 与 `concord test show` 的人读输出把原生用例和依赖项显示成 `undefined — <file>:undefined / Contract: undefined`，套用了测试 case 的渲染；`--json` 输出正确。由 docs-refactor-sdlc 实测（`/tmp/concord-closure/docs-refactor-sdlc-delivery.md` 待决 4）。

## 期望

人读输出展示与 `--json` 相同的事实，字段按 [CLI](../feature/local-sdlc/cli.md) 中这些命令的人读格式呈现，不出现 `undefined`。
