# TS-only 运行时边界

运行时只接受当前严格 Schema，不提供兼容投影或格式转换入口。

## 拒绝与协调

安全定位消费者后，只读识别旧 journal。旧事务优先返回 JournalMigrationRequired，指向离线恢复。只有旧 marker（包括 dual 与 dangling symlink）时返回 ProjectMigrationRequired，仅用 lstat 检测其存在，不读取正文。未知或损坏 journal 仍按 InvalidData 拒绝。锁外检查只能拒绝，不授权任何读写。可继续者仍取得共享或独占 lease 并锁内重验；CLI、init、dry-run、recover 和 workspace 采用一致分类。

拒绝静态旧现场不得创建、删除、chmod 或改写配置、journal、generic lock、publication.lock、事务目标及临时文件。历史事务须由匹配的工具版本在隔离环境严格验证和恢复。不可建议删除现场或循环执行普通 recover。

## 格式与恢复

当前 ConfigSnapshot 仅允许 concord.config.ts，source 必须为实际静态 TS 原文，digest 绑定其完整字节。journal scope 必须含 TS configPath、configSource、configDigest。旧无冻结字段 scope、缺 configPath 但携带匹配摘要的旧 JSON source scope、JSON scope、含 concord.json change 的事务返回 JournalMigrationRequired。坏 JSON、未知格式、残缺 TS scope 返回 InvalidData；摘要或前像冲突返回恢复错误。拒绝识别器不解析旧配置或构造旧授权。

TS 缺失仅允许完整匹配的 prepared-init：空冻结 source 与正确摘要、唯一 TS 创建 change、before:null、合法非空 after、projectId 一致；当前配置不存在或等于 after，全部目标通过前像校验。默认配置不授予恢复权。普通 publish 不得删除或改名唯一配置；config.set 单独更新 TS。当前 config.set 与 source journal 的精确 before/after 恢复继续支持。

收据必须含 TS configPath 与 configDigest。旧缺绑定收据不进入当前 Evidence 模型；保留原文件并重新取证，不补字段或重算摘要升级为新 proof。

## 验收

JSON-only、dual、子目录发现、workspace、JS绕过类型调用、旧owner发布均须具名拒绝。旧 unscoped/JSON-scope/含JSON change journal 与坏TS scope 的拒绝必须早于遗留锁删除；比较配置/锁/journal/目标/temp内容、存在性与权限。当前 prepared-init/config-before-after/source恢复以及多来源、宪法、Note、Research null语义继续通过。完整 pnpm check 和 packed consumers 验收不得绕过。

## 验收边界

错误优先级、拒绝识别边界与无配置恢复例外按上述契约验收。锁外只读识别只允许拒绝，不授权修改协调文件。离线迁移须给出迁移阻断诊断；普通运行时不恢复旧 journal。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不提供旧版本运行时兼容) | satisfied | 旧 journal、marker、JSON scope 和旧收据分别具名拒绝或重新取证，不进入当前授权。 | 原候选正文完整定义拒绝分类和旧证据边界。 |
| [L2](../../LIMITS.md#l2-保留协调文件与领域语义) | satisfied | 锁外只读拒绝，拒绝路径不改写锁/journal/目标/temp；当前 config 与领域语义继续支持。 | 原候选正文明确现场保护与当前恢复。 |
| [L3](../../LIMITS.md#l3-离线脚本独立拥有历史数据迁移) | satisfied | 一次性迁移由 scripts 拥有，runtime 不提供 registry、fallback 或旧 journal 恢复。 | 原候选正文明确迁移归属。 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-普通入口只接受静态-ts-配置) | satisfied | ConfigSnapshot 只允许 concord.config.ts，旧格式返回具名迁移错误且不解析。 | 原候选正文明确当前格式和拒绝行为。 |
| [G2](../../GOALS.md#g2-旧现场拒绝不破坏恢复现场) | pending | 设计明确拒绝不改现场并支持当前精确恢复；本次格式迁移不复验完整 gate/packed consumers，原记录证明范围不扩大。 | [验收](#验收)保留原验收范围；这是设计论证，不是本次执行证明。 |
