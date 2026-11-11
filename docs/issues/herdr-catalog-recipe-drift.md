---
relations:
  - role: spec
    target: docs/engineering/build/use-case/share-herdr-mod.md#build
---
# Herdr 分发说明与生成模板不一致

## 观察

分发目录的 RECIPE.md 声明右键菜单行为，生成模板仍声明路径不能点击，导致可重复构建校验失败。

## 期望行为

从源码生成的分发目录与已提交目录一致，说明包含文档、路径、测试与代码的右键菜单。

## 复现

运行 `bun run test test/domain/herdr-mod-build.test.ts`，RECIPE.md 的字节一致性断言失败。
