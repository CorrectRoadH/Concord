---
format: concord.document/v1
id: inspect-relationship-gaps
title: 检查契约与 CLI 页面的实现和测试关系缺口
createdAt: 2026-09-21T00:00:00.000Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 检查契约与 CLI 页面的实现和测试关系缺口

## 用户目标

维护者和 coding agent 在修改功能前，需要一次看到哪些 Feature、Use Case 和已建档 CLI 页面还没有 Concord 可观察的实现或测试关系，从而先补齐契约，再规划实现与验收。

## 完整路径

1. 运行 `concord trace gaps --json`，从当前文档 owner、源码声明和测试注释重新派生关系。
2. 查看 Feature 与 Use Case 中缺少 `implements` 或 active test contract 关系的项目。
3. 查看 `docs/feature/*/cli.md` 中没有直接实现或测试关系的页面；按页面或 anchor 建立精确关系。
4. 先修改 Feature、Use Case、CLI 页面或必要 Design，再修改功能代码与测试。
5. 重新运行 gaps、check 和项目自己的质量门。

## 可观察验收

- 输出稳定区分契约缺口与 CLI 页面缺口，并分别列出缺少 code、test 的关系类型。
- Feature 汇总自身、supporting pages 与其 Use Case 的关系；Use Case 只报告自身关系。CLI 页面要求关系直接指向该页面或其 anchor，不能由泛化 Feature 关系冒充。
- retired 测试不满足 active test 关系；无效 owner 或声明先由现有 trace finding 阻断。
- 结果只表示 Concord 当前没有观察到显式关系，不称为代码覆盖率、命令覆盖率、功能缺失或测试执行证明。
- CLI 只能审计已经存在的 CLI 页面；未建档命令不在本命令的发现能力内，必须通过产品自身 inventory 或评审补充。

## 契约来源

[本地 SDLC 闭环](../README.md)。实现与测试在各自 owner 中建立当前关系；本页不维护反向登记表。
