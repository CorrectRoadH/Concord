# TS-only 运行时边界

用户要求普通运行时不提供旧版本兼容；一次性迁移位于 scripts，不能作为 runtime registry 或 CLI fallback。

## 拒绝与协调

安全定位消费者后，只读识别旧 journal，明确旧事务优先 JournalMigrationRequired，以指向先离线恢复；只有旧 marker（包括 dual 与 dangling symlink）时 ProjectMigrationRequired，仅用 lstat 检测其存在，不读取正文。未知/损坏 journal 仍按 InvalidData 拒绝。锁外检查只能拒绝，不授权任何读写。可继续者仍取得共享/独占 lease 并锁内重验；CLI、init、dry-run、recover 和 workspace 采用一致分类。

拒绝静态旧现场不得创建、删除、chmod 或改写配置、journal、generic lock、publication.lock、事务目标及临时文件。若需要处理历史事务，先由显式离线恢复严格验证现场，再执行 JSON→TS 迁移；本次运行时和配置迁移脚本均不声称提供旧 journal 恢复。不可建议删除现场或循环执行普通 recover。

## 格式与恢复

当前 ConfigSnapshot 仅允许 concord.config.ts，source 必须为实际静态 TS 原文，digest 绑定其完整字节。journal scope 必须含 TS configPath、configSource、configDigest。旧无冻结字段 scope、缺 configPath 但携带匹配摘要的旧 JSON source scope、JSON scope、含 concord.json change 的事务返回 JournalMigrationRequired；坏 JSON、未知格式、残缺 TS scope 返回 InvalidData；摘要/前像冲突返回恢复错误。拒绝识别器不解析旧配置或构造旧授权。

TS 缺失仅允许完整匹配的 prepared-init：空冻结 source 与正确摘要、唯一 TS 创建 change、before:null、合法非空 after、projectId 一致；当前配置不存在或等于 after，全部目标通过前像校验。默认配置不授予恢复权。普通 publish 不得删除或改名唯一配置；config.set 单独更新 TS。当前 config.set 与 source journal 的精确 before/after 恢复继续支持。

收据必须含 TS configPath 与 configDigest。旧缺绑定收据不进入当前 Evidence 模型；保留原文件并重新取证，不补字段或重算摘要升级为新 proof。

## 验收

JSON-only、dual、子目录发现、workspace、JS绕过类型调用、旧owner发布均须具名拒绝。旧 unscoped/JSON-scope/含JSON change journal 与坏TS scope 的拒绝必须早于遗留锁删除；比较配置/锁/journal/目标/temp内容、存在性与权限。当前 prepared-init/config-before-after/source恢复以及多来源、宪法、Note、Research null语义继续通过。完整 pnpm check 和 packed consumers 验收不得绕过。

## 设计挑战条件落实

2026-09-14 独立 Herdr concord-ts-only-grill-0914（GPT-6 Astra）先给出 CONDITIONAL，条件落实后最终给出 PASS（设计与验收定义）。错误优先级、拒绝识别边界与无配置恢复例外已写入上述契约及验收定义；锁外只读拒绝进一步保护协调文件。离线迁移父已提供迁移阻断诊断，普通运行时不宣称可恢复旧journal。实际实现另由完整gate验收。
