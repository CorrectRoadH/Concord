---
format: concord.document/v1
id: project-onboarding
title: 渐进式项目初始化与宪法治理
createdAt: 2026-09-14T13:52:46.538Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-008
  - docs/constitution.md#c-009
---

# 渐进式项目初始化与宪法治理

## 问题与目标

维护者需要像项目脚手架一样渐进选择 Concord 的项目配置、文档与模板，避免手工拼接初始化产物。项目宪法必须存在，后续功能规划、实施与审阅都以它为项目规则来源；功能开发发现的通用约束可以通过明确修订进入宪法。

## 已确认的需求

- 项目特点允许组合，例如 Library 与 CLI；这些选择给出可覆盖的模板页面默认值。
- `docs/constitution.md` 必需；根目录 `DESIGN.md` 是独立可选项。
- 初始化提供渐进交互与等价的非交互输入，预览完整变更，取消不写入，保留已有文件。
- 新 init 采用静态 `concord.config.ts`；旧 `concord.json` 返回具名迁移错误，双配置拒绝，不执行配置模块。
- Memory 支持多个来源；首版 provider 仅本地文件，后续 provider 可扩展。canonical 路径拥有身份，默认写入目标唯一，只读来源的间接修改也必须拒绝。
- Feature 可以推动宪法新增、修订条款；记录适用范围、理由、来源与影响，不把功能细节无限追加为全局规则。

## 交付状态与边界

已在主仓库实现渐进初始化，并按 [TS-only 裁决](../../design/ts-only-runtime/README.md) 收敛运行时格式；交付运行完整 `pnpm check`，覆盖构建、严格类型检查、打包 Git 消费者、浏览器和迁移模型。独立验收覆盖 TS 原字节恢复、多来源只读保护、宪法引用修订及协调锁。真实终端验证确认前文件变化时保留外部内容并拒绝发布。Concord 自身已采用静态 TS 配置、正式宪法及条款引用；结构检查不代表语义合规。

不生成其它框架的应用代码，不引入远端写入或自动多后端同步，不将文档存在、代码声明或命令收据称为完整合规证明。

## 验收方式

使用打包后的公开 CLI 在隔离 Git 消费仓库中验证完整用户路径；真实测试声明关联本 Feature 的 Use Case。运行 `pnpm check`，并使用 Concord 的 check、trace 与 review 检查自身契约关联。
