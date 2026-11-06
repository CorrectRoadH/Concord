---
relations:
  - role: spec
    target: docs/engineering/testing/README.md
---

# CI 分片 1 的门禁内存峰值触及上限

## 现象

CI run 42195468804（d7d7998）分片 1 在 98 秒时以 `GateResourcesInvalid` 结束：门禁 slice 的内存峰值为 7,516,192,768 字节，等于 7 GiB 的 `MemoryMax`，swap 为 0（`/tmp/concord-closure/lead5-ci-final-shard1.log:1421-1424`）。中断前完成的用例不能代表其余用例通过。

CI run 42201303479（0113297）分片 2 的峰值同样为 7 GiB（`/tmp/concord-closure/lead5-relation-ci-shard2.log:2854-2856`）。同一分片中有三处失败：`test/process/readme-quickstart.test.ts:49` 的 demo check 以 130 退出（日志 1473-1509）；`path-context-browser` 的浏览器 worker 启动与清理以 `AggregateError` 失败（`browser-shared-fixture.ts:217`，日志 2258-2269）；`test/e2e/scoped-writing-browser.e2e.ts:152` 保存术语后 5 秒内没有出现变更或前像错误提示（日志 2271-2293）。这些失败是否由内存触顶引起尚未证明，查明内存后逐个判断，不相关的另建 Issue。

## 期望

完整门禁在默认并发下的内存峰值不超过 `MemoryMax`（[共享资源与同步](../engineering/testing/README.md#共享资源与同步)）。先找出该分片中占用内存的进程与测试，再判断是默认并发对 GitHub runner 的内存估计不准，还是个别测试的实际占用超出预期。不以提高上限或减少测试规避。
