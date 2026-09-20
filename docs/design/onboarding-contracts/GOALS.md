> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代，不代表当前支持。

# 初始化配置与项目治理契约

### 判断标准

优先保证消费者兼容、引用身份稳定、真实写入目标明确、可恢复与可独立安装。配置选择必须产生可观察行为，不能只有界面与无效字段。

### 验收来源

对应 [初始化](../../feature/project-onboarding/use-case/initialize-project.md)、[模板默认值](../../feature/project-onboarding/use-case/inherit-template-defaults.md)、[Memory 来源](../../feature/project-onboarding/use-case/configure-memory-sources.md)、[宪法演进](../../feature/project-onboarding/use-case/evolve-constitution.md)。

## G1: 渐进初始化可表达

从公开 init 完成渐进选择；非交互方式表达同一配置。来源：原设计目标。判定依据是初始化选择与非交互配置产生可观察行为。

## G2: 新项目拥有宪法与可覆盖默认值

新项目必有项目宪法，可选 DESIGN.md，后续文档采用可覆盖的页面默认值。来源：原设计目标。判定依据是初始化和页面默认值契约。

## G3: 配置格式与既有项目边界明确

使用 TS 配置，同时明确既有 JSON 项目的兼容与恢复方式。来源：原设计目标；运行时兼容部分后来由 TS-only 设计替代。判定依据是历史方案是否明确记录该边界而不混淆当前支持。

## G4: Memory 多来源参与查询与写入

本地 Memory 多来源真正参与查询和写入，未来可扩展 provider。来源：原设计目标。判定依据是候选是否定义来源身份、聚合读取和写入目标。

## G5: 功能开发受宪法治理

功能开发能引用与修订宪法，审阅材料读取当前规则。来源：原设计目标。判定依据是候选是否保留显式引用、修订身份和审阅失效规则。
