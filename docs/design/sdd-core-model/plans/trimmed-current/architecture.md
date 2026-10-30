# trimmed-current 架构

## 改动

| 位置 | 改动 |
| --- | --- |
| 全部 owner | 删除 `format` 与 `createdAt`、`createdAtSource` |
| Issue | `memoryRelations`、`adoptions`、`history` 为空时省略 |
| Memory | `promotions`、`history` 为空、`epoch` 为 0 时省略 |
| 配置 | 删除 `constitution`；`format` 删除 |

读取时省略的字段按空值解码，写入时空值省略。其余 Schema、命令与检查不变。

## 验证

- 本仓库改写后 `concord check` 无 finding。
- 现有测试改用省略空值的夹具后通过。
