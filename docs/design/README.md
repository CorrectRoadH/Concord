# Design 裁决

Design 在共同目标与限制下比较自包含候选，并通过 `design decide` 保存唯一选择、目标和理由。候选页面不是第二份 metadata 真源。

使用 `concord design create --help` 创建，使用 `concord design list/show` 查询。

- [初始化配置与项目治理契约](onboarding-contracts/README.md)：比较兼容演进与整体替换，记录独立挑战及验收条件；原采用兼容演进，运行时兼容部分已由下述 TS-only 裁决替代。

- [仅静态 TS 的运行时与离线迁移边界](ts-only-runtime/README.md)：当前生效的配置、事务和证据迁移边界。
