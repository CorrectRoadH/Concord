# 测试通过 Spec 注释关联并自动派生执行身份

测试只需要在顶层声明旁放置一个指向 canonical Feature 或 Use Case 的注释。测试名称和文件路径共同决定自动派生的执行 reference，因此名称不携带 ID，也不存在先分配 ID、再 attach contract 的前置步骤。

采用 direct-contract annotations：使用 `@feature <canonical-path>` 或 `@use-case <canonical-path>` 直接建立测试到 Spec 的关系；多个测试可以指向同一个 Spec。Concord 自动生成 `neref_...` execution reference，并校验目标路径的实际 Feature/Use Case 类型。人工 ID、allocate-id、attach、owner 中间状态及标题 token 方案均未采用；保留 [title-token](plans/title-token/README.md) 仅作历史候选记录。

Concord 拥有 AST 解析、派生 reference 和 Spec 关系校验；消费仓库继续拥有原生 collection、执行副本及 formal evidence，不将静态发现冒充原生执行。真实消费仓库迁移和验证须另行完成。

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [验收场景](CASES.md)
- [裁决依据](DECISION.md)

## Constitution

- [C-001](../../constitution.md#c-001)
- [C-003](../../constitution.md#c-003)
- [C-004](../../constitution.md#c-004)
- [C-005](../../constitution.md#c-005)
- [C-006](../../constitution.md#c-006)
- [C-007](../../constitution.md#c-007)
- [C-009](../../constitution.md#c-009)
