# Goals

## G1: Read cost independent of ancestor width

仓库对象构造之后，只读快照内的读取不再枚举仓库根之上的任何目录；读取阶段与结束核验的拼写检查各自每目录至多枚举一次；每次目录成员扫描仍须新鲜枚举，不复用缓存成员集合。构造阶段的枚举次数单独计数并给出上限。判据为场景 C4 按“仓库根之上 / 仓库内”分类的 `readdirSync` 计数。

## G2: Refresh scan within the limit

`scale` 消费者（默认规模）的刷新扫描在 `pnpm bench query` 中满足[刷新上限](../../feature/local-data-engine/use-case/query-asynchronous-projections.md#刷新上限)。判据为场景 C6。
