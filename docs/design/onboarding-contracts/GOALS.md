> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代，不代表当前支持。

# 初始化配置与项目治理契约

## 目标

- G1：从公开 init 完成渐进选择；非交互方式表达同一配置。
- G2：新项目必有项目宪法，可选 DESIGN.md，后续文档采用可覆盖的页面默认值。
- G3：使用 TS 配置，同时明确既有 JSON 项目的兼容与恢复方式。
- G4：本地 Memory 多来源真正参与查询和写入，未来可扩展 provider。
- G5：功能开发能引用与修订宪法，审阅材料读取当前规则。

## 判断标准

优先保证消费者兼容、引用身份稳定、真实写入目标明确、可恢复与可独立安装。配置选择必须产生可观察行为，不能只有界面与无效字段。

## 验收来源

对应 [初始化](../../feature/project-onboarding/use-case/initialize-project.md)、[模板默认值](../../feature/project-onboarding/use-case/inherit-template-defaults.md)、[Memory 来源](../../feature/project-onboarding/use-case/configure-memory-sources.md)、[宪法演进](../../feature/project-onboarding/use-case/evolve-constitution.md)。
