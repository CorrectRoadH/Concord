---
format: concord.document/v1
id: discover-annotated-tests
title: 发现测试并重建缓存
createdAt: 2026-09-13T11:00:35.003Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 发现测试并重建缓存

## 场景

作为测试维护者，我希望在真实 `node:test`、Vitest 等受支持的静态声明旁维护 case、contract 与 regression 注释，并让查询在缓存损坏时仍以源码为准。

## 主流程

1. 用 `test annotate` 验证新 case id、契约目标和 Problem 引用，复制输出片段到真实测试声明正上方。
2. `test list/show` 或 `check` 扫描配置的 testRoots，并解析受支持 runner import 的绑定。
3. SQLite 以项目、路径集合、文件摘要、runner 配置和解析器版本作为身份；有效缓存命中才复用投影。
4. 文件修改、重命名、删除、配置变化或缓存损坏时从权威源码重建。

## 验收

- 普通同名 helper、字符串或模板中的伪注释不注册 case。
- 重复 id、悬空注释、动态或歧义声明产生明确 finding。
- retired/skip 状态被识别，不能用于 fixed 证据。
