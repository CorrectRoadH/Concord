> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../ts-only-runtime/README.md) 替代，不代表当前支持。

# 初始化配置与项目治理契约

## 约束

- 保持本地独立安装，不依赖外部 checkout、付费模型或远端 mutation。
- 保留既有消费者、未知工作区改动和现有 Memory 历史；不可静默改写引用身份。
- 配置入口、读取、编辑、证据及恢复使用一致协议，普通查询不能暗中执行消费者脚本。
- 新项目宪法必需，DESIGN.md 可选；规则内容不冒充实现证据。
- 本轮不实现远端 provider 或跨后端自动同步。
- 严格 TypeScript、Effect 与固定依赖，公开验收使用隔离打包消费者。

## 候选

[兼容演进](plans/compatible/README.md) 保留旧配置和身份；[整体替换](plans/replacement/README.md) 引入可执行 TS 与跨目录来源，需要更大迁移。
