# Decision

## Decision

Selected: [directory-owned](plans/directory-owned/README.md)

## Rationale

目录直接拥有术语与政策作用域，全项目视图只派生。写入、恢复、迁移和有效语料遵守采用方案中的明确限制。

## Rejected Options

central-registry 重复保存 scope，且局部事实离开所属目录。继续解析 Markdown 表格无法可靠区分允许别名和弃用名称。

## Residual Risks

当前格式转换须作者审核定义与弃用名称；检查不能代替领域语义判断，旧版中断事务必须先由旧版恢复。
