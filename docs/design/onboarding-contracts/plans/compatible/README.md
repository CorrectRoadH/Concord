> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../../../ts-only-runtime/README.md) 替代，不代表当前支持。

# 兼容演进候选

## 配置

新 init 生成 concord.config.ts；旧 concord.json 继续读取，双配置拒绝。TS 是严格静态数据：一个 export default 字面对象，可带类型导入、as const、satisfies；不执行模块或解析类型依赖。重复键、spread、computed key、调用及额外运行时语句拒绝。正常工具编辑可规范化整个文件；恢复严格还原原文字节。

共享配置快照保存 path、source、digest、config，同一次读取的 source 直接用作 publication 前像。新证据 definition 与运行稳定性校验绑定配置路径与原文摘要；旧证据保留历史读取，不冒充新定义证据。

## 写入与恢复

新事务冻结配置快照；普通文档与源码写入要求当前配置等于冻结 source。config.set 单独发布，不与 Memory 修改混批。init 根据计划配置授权创建路径，prepared 配置未发布或已发布时都按原计划回滚。双配置、外部配置编辑不得扩大恢复授权；committed 要求完整 after。旧 journal 只保留原固定授权，不据新增来源扩权。

## Memory

首版 provider 为 local-files，来源限定当前 worktree 内不重叠的安全目录。canonical path 拥有身份，同来源内 ID 唯一，跨来源短 ID 歧义拒绝。来源名称不改变身份；改目录不是自动迁移。默认写入来源唯一；统一 publication 检查只读权限，含 author、metadata、Markdown 与 adoption 间接写入。需要修改只读 Memory 的 adoption 整批拒绝。额外来源缺失不能静默视为空；fixed 用解析后的 canonical Problem 路径比对回归关系，仍使用当前消费者证据。

## 宪法与模板

新项目配置声明 docs/constitution.md。未输入已采用规则时生成明确 draft 骨架，doctor/check/review 展示待完善，不把模板样例当作规则或合规证明。旧消费者未接入时保留现行检查兼容，doctor 提示显式补齐。宪法状态无效不阻碍 recover 或必要修复。

条款用显式稳定 HTML anchor；Feature/Design 的可选 constitutionRefs 声明适用规则，反向影响派生。宪法不成为测试契约或代码实现目标。修订 CAS 更新版本、日期、正文、来源和影响；review 读取当前正文与摘要，不推断语义合规。

页面省略采用项目默认值，显式空数组表示仅 README，CLI 与结构化入口保持一致。DESIGN.md 独立可选。交互完成前只读取和规划，确认后重新核验前像再发布。

## 状态

已采用。共享 lease 与模型迁移的主仓库集成已通过 `pnpm check` 132 项测试；Concord 自身已通过公开 CLI 采用宪法并关联 Feature/Design 条款。
