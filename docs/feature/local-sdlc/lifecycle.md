# 生命周期

## 从接入到契约

初始化只在 Git worktree 顶层执行并以冲突即失败保护已有文件。Feature 与 Use Case 建立当前契约；Roadmap 被采用后复制完整 Markdown package、调整安全链接并保留 adopted 历史，当前语义转由新 Feature 拥有。

## 从声明到证据

测试注释经扫描成为当前 case 投影。运行前后都核对定义、契约和候选摘要；普通非零退出可作为 red，成功且清理完整可作为 green。通用 runner 的 observed execution 可以是 `unknown`；已知 zero/skipped，或默认 Node TAP 结果无法可靠解析时收据为 invalid。源码或声明 sourceFiles 漂移后，旧收据不能关闭当前 Problem。

## Memory

Problem 从 epoch 0 开始，reopen 增加 epoch 并将旧 resolution 追加进 history。Decision 与 Insight 可被同 kind 的新 Memory supersede；promotion 只指向有效当前契约，retire 保留历史。新 clone 缺少私有证据时，历史 resolution 可读但标记为 unavailable。

## 退役与恢复

测试关系用 `@concord-status retired` 明示退役。缓存可随时 clear/rebuild。未完成写入由 recover 根据 journal 恢复；未知编辑导致具名冲突，必须由维护者裁决。
