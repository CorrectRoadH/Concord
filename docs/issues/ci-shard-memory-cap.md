---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# CI 分片 1 的门禁内存峰值触及上限

## 现象

CI run 42195468804（d7d7998）分片 1 在 98 秒时以 `GateResourcesInvalid` 结束：门禁 slice 的内存峰值为 7,516,192,768 字节，等于 7 GiB 的 `MemoryMax`，swap 为 0（`/tmp/concord-closure/lead5-ci-final-shard1.log:1421-1424`）。中断前完成的用例不能代表其余用例通过。

## 期望

完整门禁在默认并发下的内存峰值不超过 `MemoryMax`（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。先找出该分片中占用内存的进程与测试，再判断是默认并发对 GitHub runner 的内存估计不准，还是个别测试的实际占用超出预期。不以提高上限或减少测试规避。
