# Concord 独立化设计

本方案经过独立只读设计挑战并获 PASS。当前契约由 [Architecture](architecture.md) 拥有；本页保存候选比较和裁决。

## 目标与来源

Concord 把 NiceEval 的契约、测试归属、工程记忆与审阅闭环变成可安装到任意 Git 仓库的本地 CLI。源仓库为 `/home/ctrdh/.herdr/worktrees/NiceEval/repot-tool`，基线为 `e1c66d31115208ceaae2f5bd4d730a7abf67048d`。新仓库为 `/home/ctrdh/Code/Concord`。

保留的原则是契约先于实现、每个事实有唯一 owner、反向关系动态派生、Problem 关闭需要真实运行证据、历史不被覆盖、机器输入严格校验。抽取包括通用领域行为与可复用代码；不把 NiceEval 产品 E2E 编排器、Mintlify、Netlify、产品发布和旧 Feedback 迁移一并搬入。

NiceEval 现有代码和数据保持原位，本次不迁移已有 Memory、不替换其命令、不降级其 formal evidence gate。Concord 使用自己的格式与证据语义，不能把原有 NiceEval 证书转换成普通命令结果。

## 候选方案

1. 整包复制 repo-tools 与 e2e-runner。可以保留接口，但带入产品构建、Testkit、Nx、模板及下游部署假设，不满足独立性。
2. 抽出契约和生命周期领域，在新项目重建宿主、存储和测试执行边界；复用可独立的引用校验和生命周期规则。采用此方案。
3. 只提供 Markdown 模板。不能建立关系检查和证据闭环，不满足任务。

## 存储裁决

采用测试源码注释保存测试关系，Markdown 加严格 frontmatter 保存契约及工程记忆，SQLite 保存可丢弃的解析缓存。项目配置继续使用 JSON；运行证据和事务恢复材料与 cache 分开存储。

此组合让关系随测试参与 Git diff，同时保持查询可重建。完整行为、执行证据边界和恢复协议见 [Architecture](architecture.md)。独立只读挑战在明确 command 证据层级、当前 ID 唯一性以及缓存非权威性之后给出 PASS。
