---
format: concord.document/v1
id: project-onboarding
title: 渐进式项目初始化与宪法治理
createdAt: 2026-09-14T13:52:46.538Z
kind: feature
---


# 渐进式项目初始化与宪法治理

## 问题与目标

维护者需要像项目脚手架一样渐进选择 Concord 的项目配置、文档与模板，避免手工拼接初始化产物。项目宪法必须存在，后续功能规划、实施与审阅都以它为项目规则来源；功能开发发现的通用约束可以通过明确修订进入宪法。

## 已确认的需求

- 项目特点允许组合，例如 Library 与 CLI；这些选择给出可覆盖的模板页面默认值。
- `docs/constitution.md` 必需；根目录 `DESIGN.md` 是独立可选项。
- 初始化提供渐进交互与等价的非交互输入，预览完整变更，取消不写入，保留已有文件。
- 初始化指引要求 Spec 声明目标，开发过程归 Memory；Memory/Issue 的索引、检索和修改全部通过 Concord 工具。
- 初始化在根 `AGENTS.md` 中维护有边界标记的 Concord 指引，保留区块外正文，并引导 coding agent 从已安装版本运行 `concord --skill` 按任务读取说明。
- 新 init 采用静态 `concord.config.ts`；旧 `concord.json` 返回具名迁移错误，双配置拒绝，不执行配置模块。
- Memory 支持多个来源，provider 为本地文件。canonical 路径拥有身份，默认写入目标唯一，只读来源的间接修改也必须拒绝。
- Feature 可以推动宪法新增、修订条款；记录适用范围、理由、来源与影响，不把功能细节无限追加为全局规则。

## 边界

不生成其它框架的应用代码，不引入远端写入或自动多后端同步，不将文档存在、代码声明或命令收据称为完整合规证明。

## 验收方式

使用打包后的公开 CLI 在隔离 Git 消费仓库中验证完整用户路径；真实测试声明关联本 Feature 的 Use Case。运行 `pnpm check`，并使用 Concord 的 check、trace 与 review 检查自身 Spec 关联。

## 性能预算

按[性能验收](../../engineering/concord-self-hosting/performance.md)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `project-onboarding/config` | 读取配置 | 670ms |
| `project-onboarding/constitution` | 读取宪法及引用 | 880ms |
| `project-onboarding/doctor` | 接入诊断 | 5250ms |

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-008](../../constitution.md#c-008)
- [C-009](../../constitution.md#c-009)
- [C-012](../../constitution.md#c-012)
- [C-002](../../constitution.md#c-002)
