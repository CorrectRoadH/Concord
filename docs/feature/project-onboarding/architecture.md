# 渐进式项目初始化与宪法治理架构

运行时只接受当前静态 TS 配置，避免并存多个授权模型（[决策依据](../../design/ts-only-runtime/DECISION.md)）。

## 配置快照

`ConfigSnapshot` 为 `{path: "concord.config.ts", source, digest, config}`：`source` 是实际原文，`digest` 绑定其完整字节。`config` 由 TypeScript 语法树静态求值后按 `ProjectSchema` 严格解码，不加载模块，不解析类型依赖。同一次读取的 `source` 直接作为发布前像。新事务冻结该快照；普通文档与源码写入要求当前配置仍等于冻结 `source`。`config.set` 单独发布并重写规范化 TS 全文，不与 Memory 修改同批；普通发布不得删除或改名唯一配置。

## 运行时格式识别

安全定位消费者后，先只读识别 Git-private 目录中的 journal。

| 现场 | 结果 |
| --- | --- |
| journal、配置或 TS scope 不符合当前 Schema | `InvalidData`，保留现场并阻断写入 |
| 摘要或前像冲突 | 恢复错误 |

锁外识别只能拒绝，不授权读写；可继续者仍取得共享或独占 lease 并在锁内重验。拒绝路径不创建、删除、chmod 或改写配置、journal、通用锁、`publication.lock`、事务目标与临时文件。

## Journal 与恢复授权

每个 journal scope 携带 `configPath: "concord.config.ts"`、`configSource` 与 `configDigest`。恢复按冻结快照授权：双配置或外部配置编辑不扩大授权，committed 要求完整 after。`config.set` 与 source journal 按精确 before/after 恢复。

配置缺失时只有完整匹配的 prepared-init 可恢复：冻结 `source` 为空且摘要正确，唯一的配置 change 为 `before: null` 与合法非空 after，`projectId` 一致；当前配置不存在或等于 after，全部目标通过前像校验。默认配置不授予恢复权。

## 初始化规划

init 的 `projectId`、配置路径与 Memory 范围取自最终计划配置快照；新建目录只能是计划文件的必要祖先。发布与恢复检查 canonical 路径、symlink 与完整前像集合。预览采用乐观快照，并遵守通用与 repository profile 的 journal 障碍；确认后才取得独占所有权并重验全部前像，确认期间变化的创建或保留文件返回 `PreimageChanged`。

## 证据绑定

命令收据含 `configPath` 与 `configDigest`，签发与核验都比较当前快照。缺少这两个字段的收据不符合当前 Schema，返回 `InvalidData`，原文件保留，需要重新取证。

## 宪法

条款与款 ID 从 Markdown 语法树的标题与根有序列表项取得。引用扫描复用共享的链接提取与路径规范化，不另建索引。adopt 与 amend 把宪法与 Decision Memory 写入同一个 journal 后逐文件替换，`recover` 按前后像完成或回退，遇到未知编辑拒绝。
