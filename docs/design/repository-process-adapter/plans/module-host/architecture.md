# 模块接入架构

`concord.repository/v2` 声明 suites、historyPath、policy 和可选 host 模块路径。

host default export 含 format、caseIdentity、repositoryRoot，以及六个可选能力。

收集能力为 collectRepoCaseInventory、collectWorkspaceCaseInventory；实现身份能力为 managedInventoryImplementationDigest。

证据读取能力为 readManagedInventoryReceipt、readManagedRedEvidence、readManagedTakeoverEvidence。

完整类型由 `repository/host-contract.ts` 与 `repository/host-types/index.d.ts` 拥有；每项返回 Effect，takeover receipts 使用 Map。

Concord 核验消费者锁定库与全局 CLI 的完整实现字节相同，再按需加载模块。静态 help 与查询不加载 host。

能力缺失或加载失败返回现有 RepositoryHost 与 RepositoryEngine 具名错误。Memory 检查保留底层原因并继续汇总。

消费者拥有构建、候选安装、原生运行、副本与 cleanup；Concord 共享 source identity、声明解析和 evidence-policy，并在发布与 fixed 前执行 `validateNativeEvidence`。

完整性摘要不代替原生观察，普通 native-evidence/v2 不满足可靠性下限。
