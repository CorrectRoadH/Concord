# 受管格式变化使性能对照的基线失效

性能对照的基线产物要能解码同一个冻结消费者。冻结消费者就是本仓库，所以 Concord 改变受管格式之后，更早的提交读不了当前的 docs，相对比较在这些场景上不成立（[性能测量](../docs/engineering/performance/README.md)）。

## 断点

| 断点提交 | 格式变化 | 旧基线上的表现 |
| --- | --- | --- |
| `37c1637` | 标题末尾的中文显式 ID 生成 anchor | 以 `f00803b` 为基线时，13 个场景报 `AnchorNotFound` 或 `TraceInvalid`，无法准备 |
| `0113297` | Issue 关系角色 `adopts` 改为 `spec` | 早于它的基线把当前 Issue 读为 `InvalidData` |
| `a3d25ce` | 写作检查跳过显式 ID（`36605e4`），并登记旧写法 `preimage` 与 `receipt` | 早于它的基线把这两条概念自身的定义报为 `bannedTerm`，documentation-quality 的写作场景 `docs check` 以 1 退出 |

断点所在的交付只按候选产物的绝对预算验收（`--reference`）；之后的交付以最近的断点提交为基线恢复 `--compare`。断点之前测得的回退（例如 `review-warm` p50 相对 `f00803b` 慢 28%）在断点之后无法对照，需要在新基线上重新测量后判断。
