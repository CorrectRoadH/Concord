---
format: concord.document/v1
id: hawdb-013-adoption
title: HawDB 0.13 所有权适配与发行验收
createdAt: 2026-10-23T08:25:04.488Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# HawDB 0.13 采用与发行验收

用户在初次升级调查阻塞后明确要求「开工升级发新版」，授权适配所有权和只读契约并发行。实现目标为 HawDB 0.13.0，固定 revision `91aec4960ed27516962cf1dc918307f57faef15d`；原桥接基线为 Concord `1a16741`、HawDB 0.3.0。0.13 在本次工作期间成为上游稳定发行。

## 设计与独立审查

主 agent 先完成 `docs/design/hawdb-data-engine/plans/native-embedded/engine-upgrade.md`。通过 Herdr 启动原生 Codex / GPT-6.1 Sol Review（`concord-hawdb013-design`），首轮指出清理锁删除顺序及 cache-off/config 路径遗漏；集中修订后复审无阻断。主 agent 实现并独立核验。Review pane 已回收。

采用目录外同级协调锁覆盖完整持久句柄生命周期；clear 同时取得根锁和嵌套引擎锁。先删除全部数据与 branch head，再删除嵌套锁，最后空目录，保留根目录、根锁和协调锁 inode。内部硬链接只接受所有路径都位于缓存根内的准确 dev/ino/nlink 分组；锁 inode 必须唯一。清理阶段复核身份、成员与递减链接数。

只读指逻辑缓存行不变，允许固定引擎重建派生 runtime；来源文件、证据和 journal 不变。dry-run/cache-off 完全不打开持久引擎，配置解析也关闭持久缓存。Repository 明确携带 persistentCache 策略，独立于来源读写权限。普通只读入口不再使用 0.3 专用的写恢复回退。缺失库既有入口不创建文件。

旧缓存通过引擎公开 API 接入，真实 0.3 fixture 验证配置和远端观察行保留；没有旧运行时。不同代 Concord 进程不得并发使用同一缓存，降级先用采用 0.13 的 CLI 显式 clear。无源码事实迁移，ABI 和领域 Schema 不变。

## 已完成验证

Linux 的 test-hooks 原生产物与针对性命令 `pnpm exec vp run test:built test/hawdb-native.test.ts test/hawdb-cache.test.ts test/selfhost.test.ts`：24 项通过、0 失败、0 跳过。覆盖真实旧缓存、逻辑只读、dry-run/cache-off 递归磁盘快照、跨进程互斥、延迟准入、内部/外部硬链接、清理阶段干扰、事务失败与 SIGKILL。生产构建、源码及 built 类型检查通过。

同时修正发行基线已有的写作缓存暖读仍加载 parser 的问题：先验证输入摘要与缓存，只有 miss 才解析 step markers。补齐 scripts 扫描范围及已存在实现的准确契约声明，使 selfhost 的实现关联校验通过。没有以命令收据替代原生测试覆盖。

本地完整 pnpm check 首轮为501项：490通过、4失败、7跳过。安装脚本保留路径断言已同步，Design退出超时及两个浏览器等待超时在串行复测中通过，未放宽期限。43项串行复测中的42项通过，剩余异步查询断言补齐契约允许的HawdbBusy，并等待后台刷新退出后清理消费者；该项单独复测通过。3个test-hooks用例已在独立原生验收运行；3个Darwin专属路径用例在Linux跳过，Cargo适配器的本地主机linker不可用导致1个子用例跳过。跨平台发行门禁仍待执行，不声明发行成功。性能对照基线固定在父提交 1a16741 的独立构建。新增 --isolated-caches 使两代产物在同一冻结提交的独立 clone 上各自预热并交错采样，避免跨代缓存混用。Release 工作流在 Linux 与 macOS 构建 test-hooks 并执行原生生命周期测试，再产生不含 hooks 的发行二进制。


## 性能对照结果

CLI 14组与query 6组均为 acceptance=true；每组7次全新进程，基线与候选交错采样，两代引擎使用同一冻结commit的独立clone。CLI最大p50回退3%，query历史读取最大13%；后台扫描约3.2秒，低于120秒上限。未修改任何预算。

### cli

```json
{
  "format": "concord.bench/v1",
  "path": "cli",
  "measuredAt": "2026-10-23T08:49:40.434Z",
  "environment": {
    "node": "v24.19.0",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "cpuCount": 16,
    "memoryBytes": 33576542208
  },
  "reference": false,
  "samples": 7,
  "consumer": {
    "kind": "self",
    "root": "/tmp/concord-bench-MJXaF1/self",
    "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
    "cache": "ready"
  },
  "artifacts": [
    {
      "label": "candidate",
      "dir": "/tmp/concord-hawdb-release",
      "entry": "/tmp/concord-hawdb-release/dist/entry.js",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "dirty": true,
      "digest": "sha256:7beb4ea05fae6210e3a59399430ce2f148b9ec6f02dbc926c9122818d2bad4b9"
    },
    {
      "label": "baseline",
      "dir": "/tmp/concord-hawdb013-baseline",
      "entry": "/tmp/concord-hawdb013-baseline/dist/entry.js",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "dirty": false,
      "digest": "sha256:1a698f8b3aa5879ee57aaa3b17d91af0030226cd2e1637c0dee79075f844ea5c"
    }
  ],
  "consumers": {
    "candidate": {
      "kind": "self",
      "root": "/tmp/concord-bench-MJXaF1/self",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "cache": "ready"
    },
    "baseline": {
      "kind": "self",
      "root": "/tmp/concord-bench-MJXaF1/baseline/self",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "cache": "ready"
    }
  },
  "verdicts": [
    {
      "command": "concord --help",
      "candidate": {
        "samples": [
          352.95200300000033,
          351.24312699999973,
          347.9292120000009,
          339.14098300000114,
          342.8132539999988,
          342.45830599999863,
          345.02800599999864
        ],
        "p50": 345.02800599999864,
        "max": 352.95200300000033,
        "valid": true
      },
      "baseline": {
        "samples": [
          345.5645620000014,
          345.74712,
          344.4820810000001,
          348.9235260000005,
          351.11806799999977,
          353.09189200000037,
          346.88059200000134
        ],
        "p50": 346.88059200000134,
        "max": 353.09189200000037,
        "valid": true
      },
      "regression": -0.01,
      "limitMs": 350,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord --skill",
      "candidate": {
        "samples": [
          179.62708100000054,
          177.00324200000068,
          193.6909680000026,
          180.95068999999785,
          179.0294759999997,
          182.13442099999884,
          182.2222099999999
        ],
        "p50": 180.95068999999785,
        "max": 193.6909680000026,
        "valid": true
      },
      "baseline": {
        "samples": [
          182.3176000000003,
          180.9041610000022,
          181.37002700000085,
          188.64049800000066,
          179.1096460000008,
          181.09934900000007,
          182.37812900000063
        ],
        "p50": 181.37002700000085,
        "max": 188.64049800000066,
        "valid": true
      },
      "regression": 0,
      "limitMs": 350,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord memory index",
      "candidate": {
        "samples": [
          490.4347510000007,
          497.72618299999885,
          497.3601260000032,
          499.74968699999954,
          498.80220499999996,
          494.3917599999986,
          437.68203399999766
        ],
        "p50": 497.3601260000032,
        "max": 499.74968699999954,
        "valid": true
      },
      "baseline": {
        "samples": [
          501.70520099999703,
          484.45452999999907,
          486.5560919999989,
          484.6978969999982,
          490.52430000000095,
          481.21353499999896,
          425.5750799999987
        ],
        "p50": 484.6978969999982,
        "max": 501.70520099999703,
        "valid": true
      },
      "regression": 0.03,
      "limitMs": 550,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord memory list",
      "candidate": {
        "samples": [
          492.5164259999983,
          497.5592140000008,
          506.07505700000183,
          500.8938269999999,
          486.0083569999988,
          488.87885500000266,
          496.3191139999981
        ],
        "p50": 496.3191139999981,
        "max": 506.07505700000183,
        "valid": true
      },
      "baseline": {
        "samples": [
          500.38186199999836,
          491.6318919999976,
          495.4819409999982,
          488.51749700000073,
          482.9810309999957,
          489.9229959999939,
          490.4670019999976
        ],
        "p50": 490.4670019999976,
        "max": 500.38186199999836,
        "valid": true
      },
      "regression": 0.01,
      "limitMs": 550,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord memory recall HawDB",
      "candidate": {
        "samples": [
          488.8826130000016,
          497.33206600000267,
          483.00842099999863,
          495.4360719999968,
          497.5591639999984,
          489.31851099999767,
          507.245096000006
        ],
        "p50": 495.4360719999968,
        "max": 507.245096000006,
        "valid": true
      },
      "baseline": {
        "samples": [
          488.27839899999526,
          491.90522200000123,
          500.74279899999965,
          495.6477700000032,
          490.26322300000174,
          487.3463169999959,
          491.5044530000014
        ],
        "p50": 491.5044530000014,
        "max": 500.74279899999965,
        "valid": true
      },
      "regression": 0.01,
      "limitMs": 550,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord memory search HawDB",
      "candidate": {
        "samples": [
          498.39235700000427,
          498.61941600000137,
          495.73266900000453,
          493.1438999999955,
          505.1853340000016,
          501.74536100000114,
          500.52484100000584
        ],
        "p50": 498.61941600000137,
        "max": 505.1853340000016,
        "valid": true
      },
      "baseline": {
        "samples": [
          490.8069989999931,
          495.91341799999645,
          487.29617699999653,
          500.38659099999495,
          493.7832049999997,
          498.81279400000494,
          494.3019310000018
        ],
        "p50": 494.3019310000018,
        "max": 500.38659099999495,
        "valid": true
      },
      "regression": 0.01,
      "limitMs": 550,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord issue index",
      "candidate": {
        "samples": [
          469.89522600000055,
          462.8988820000013,
          498.2774389999977,
          475.4049230000019,
          468.65434699999605,
          476.0985660000006,
          465.78951000000234
        ],
        "p50": 469.89522600000055,
        "max": 498.2774389999977,
        "valid": true
      },
      "baseline": {
        "samples": [
          460.0857939999987,
          467.10076899999694,
          463.17547999999806,
          469.27300199999445,
          468.53336700000364,
          469.29740099999617,
          466.0715679999994
        ],
        "p50": 467.10076899999694,
        "max": 469.29740099999617,
        "valid": true
      },
      "regression": 0.01,
      "limitMs": 500,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord issue list",
      "candidate": {
        "samples": [
          468.9223939999938,
          473.7719159999979,
          484.12228300000424,
          474.6921880000009,
          480.6272409999947,
          482.65234499999497,
          486.1127570000099
        ],
        "p50": 480.6272409999947,
        "max": 486.1127570000099,
        "valid": true
      },
      "baseline": {
        "samples": [
          469.15124300000025,
          464.99943599999824,
          479.43912999999884,
          470.99639699999534,
          472.08789799999795,
          482.42595599999186,
          463.3836889999948
        ],
        "p50": 470.99639699999534,
        "max": 482.42595599999186,
        "valid": true
      },
      "regression": 0.02,
      "limitMs": 500,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord issue recall HawDB",
      "candidate": {
        "samples": [
          477.40246599999955,
          465.7321200000006,
          470.2098939999996,
          477.2592880000011,
          471.38890400000673,
          464.2311219999974,
          474.40938100000494
        ],
        "p50": 471.38890400000673,
        "max": 477.40246599999955,
        "valid": true
      },
      "baseline": {
        "samples": [
          456.3205650000018,
          471.60046300000977,
          475.6259909999935,
          470.8041999999987,
          458.1555609999923,
          476.2400859999907,
          462.12590899999486
        ],
        "p50": 470.8041999999987,
        "max": 476.2400859999907,
        "valid": true
      },
      "regression": 0,
      "limitMs": 500,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord feature list",
      "candidate": {
        "samples": [
          650.2700519999926,
          640.088533999995,
          640.4225420000002,
          649.3966289999953,
          653.1073390000092,
          638.3445769999962,
          632.0922580000042
        ],
        "p50": 640.4225420000002,
        "max": 653.1073390000092,
        "valid": true
      },
      "baseline": {
        "samples": [
          652.1363669999992,
          654.6934060000058,
          673.7546629999997,
          664.3132490000135,
          655.3904110000003,
          649.5121179999987,
          641.8344499999948
        ],
        "p50": 654.6934060000058,
        "max": 673.7546629999997,
        "valid": true
      },
      "regression": -0.02,
      "limitMs": 600,
      "limitKind": "p50",
      "withinLimit": false,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord docs check",
      "candidate": {
        "samples": [
          660.1182740000077,
          586.0297760000103,
          615.8325479999912,
          634.3947000000044,
          639.323510000002,
          628.9223930000007,
          645.8748979999946
        ],
        "p50": 634.3947000000044,
        "max": 660.1182740000077,
        "valid": true
      },
      "baseline": {
        "samples": [
          717.1694570000109,
          706.7861499999999,
          744.013982000004,
          741.1708050000016,
          805.7316570000112,
          767.2338950000121,
          760.2622109999938
        ],
        "p50": 744.013982000004,
        "max": 805.7316570000112,
        "valid": true
      },
      "regression": -0.15,
      "limitMs": 1000,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord --fresh trace show docs/feature/local-sdlc/README.md",
      "candidate": {
        "samples": [
          1934.9672139999893,
          1970.6241290000034,
          1766.8172020000056,
          1799.4398600000131,
          1867.1909980000055,
          1732.7670750000107,
          1988.2663780000003
        ],
        "p50": 1867.1909980000055,
        "max": 1988.2663780000003,
        "valid": true
      },
      "baseline": {
        "samples": [
          1734.2853020000039,
          1735.5084820000047,
          1750.820188999991,
          1948.0874900000053,
          1884.7780569999886,
          1916.6607420000073,
          1899.157772000006
        ],
        "p50": 1884.7780569999886,
        "max": 1948.0874900000053,
        "valid": true
      },
      "regression": -0.01,
      "limitMs": 1300,
      "limitKind": "p50",
      "withinLimit": false,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord trace check",
      "candidate": {
        "samples": [
          1785.1365759999899,
          1848.7299969999876,
          1814.7271689999907,
          1800.0733260000125,
          1688.666629000014,
          1793.8871470000013,
          1808.748798000015
        ],
        "p50": 1800.0733260000125,
        "max": 1848.7299969999876,
        "valid": true
      },
      "baseline": {
        "samples": [
          1560.9572610000032,
          1766.637274000008,
          1743.6511480000045,
          1747.3780890000053,
          1691.572325999994,
          1777.9109750000061,
          1761.3373370000045
        ],
        "p50": 1747.3780890000053,
        "max": 1777.9109750000061,
        "valid": true
      },
      "regression": 0.03,
      "limitMs": 1300,
      "limitKind": "p50",
      "withinLimit": false,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord check",
      "candidate": {
        "samples": [
          1892.5451079999912,
          1908.1764820000099,
          1903.9901050000044,
          1892.1877600000007,
          1872.0833920000005,
          1889.6804709999997,
          1742.3914400000067
        ],
        "p50": 1892.1877600000007,
        "max": 1908.1764820000099,
        "valid": true
      },
      "baseline": {
        "samples": [
          1931.4615259999991,
          1941.6087950000074,
          1941.0596289999958,
          1932.445768000005,
          1870.6124530000088,
          1697.6548179999809,
          1910.0348269999959
        ],
        "p50": 1931.4615259999991,
        "max": 1941.6087950000074,
        "valid": true
      },
      "regression": -0.02,
      "limitMs": 2300,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    }
  ],
  "cold": [
    {
      "command": "concord --help",
      "artifact": "candidate",
      "ms": 351.6263230000004,
      "exitCode": 0
    },
    {
      "command": "concord --help",
      "artifact": "baseline",
      "ms": 347.2553480000006,
      "exitCode": 0
    },
    {
      "command": "concord --skill",
      "artifact": "candidate",
      "ms": 187.70968599999833,
      "exitCode": 0
    },
    {
      "command": "concord --skill",
      "artifact": "baseline",
      "ms": 180.48348400000032,
      "exitCode": 0
    },
    {
      "command": "concord memory index",
      "artifact": "candidate",
      "ms": 490.7401580000005,
      "exitCode": 0
    },
    {
      "command": "concord memory index",
      "artifact": "baseline",
      "ms": 487.4350360000026,
      "exitCode": 0
    },
    {
      "command": "concord memory list",
      "artifact": "candidate",
      "ms": 504.0812619999997,
      "exitCode": 0
    },
    {
      "command": "concord memory list",
      "artifact": "baseline",
      "ms": 491.30021399999896,
      "exitCode": 0
    },
    {
      "command": "concord memory recall HawDB",
      "artifact": "candidate",
      "ms": 497.86292200000025,
      "exitCode": 0
    },
    {
      "command": "concord memory recall HawDB",
      "artifact": "baseline",
      "ms": 501.4898630000025,
      "exitCode": 0
    },
    {
      "command": "concord memory search HawDB",
      "artifact": "candidate",
      "ms": 501.69359200000326,
      "exitCode": 0
    },
    {
      "command": "concord memory search HawDB",
      "artifact": "baseline",
      "ms": 502.3470059999963,
      "exitCode": 0
    },
    {
      "command": "concord issue index",
      "artifact": "candidate",
      "ms": 474.3135509999993,
      "exitCode": 0
    },
    {
      "command": "concord issue index",
      "artifact": "baseline",
      "ms": 460.6947300000029,
      "exitCode": 0
    },
    {
      "command": "concord issue list",
      "artifact": "candidate",
      "ms": 469.8234769999981,
      "exitCode": 0
    },
    {
      "command": "concord issue list",
      "artifact": "baseline",
      "ms": 472.84866200000397,
      "exitCode": 0
    },
    {
      "command": "concord issue recall HawDB",
      "artifact": "candidate",
      "ms": 472.8612520000024,
      "exitCode": 0
    },
    {
      "command": "concord issue recall HawDB",
      "artifact": "baseline",
      "ms": 452.4604360000085,
      "exitCode": 0
    },
    {
      "command": "concord feature list",
      "artifact": "candidate",
      "ms": 638.3026380000083,
      "exitCode": 0
    },
    {
      "command": "concord feature list",
      "artifact": "baseline",
      "ms": 657.2128560000128,
      "exitCode": 0
    },
    {
      "command": "concord docs check",
      "artifact": "candidate",
      "ms": 1516.202158,
      "exitCode": 0
    },
    {
      "command": "concord docs check",
      "artifact": "baseline",
      "ms": 1149.599292999992,
      "exitCode": 0
    },
    {
      "command": "concord --fresh trace show docs/feature/local-sdlc/README.md",
      "artifact": "candidate",
      "ms": 3812.9911449999927,
      "exitCode": 0
    },
    {
      "command": "concord --fresh trace show docs/feature/local-sdlc/README.md",
      "artifact": "baseline",
      "ms": 3495.8174750000035,
      "exitCode": 0
    },
    {
      "command": "concord trace check",
      "artifact": "candidate",
      "ms": 3681.525020000001,
      "exitCode": 0
    },
    {
      "command": "concord trace check",
      "artifact": "baseline",
      "ms": 3265.1191629999958,
      "exitCode": 0
    },
    {
      "command": "concord check",
      "artifact": "candidate",
      "ms": 4109.670914999995,
      "exitCode": 0
    },
    {
      "command": "concord check",
      "artifact": "baseline",
      "ms": 3789.3728300000075,
      "exitCode": 0
    }
  ],
  "snapshots": [],
  "pass": true,
  "acceptance": true
}
```

### query

```json
{
  "format": "concord.bench/v1",
  "path": "query",
  "measuredAt": "2026-10-23T08:53:15.775Z",
  "environment": {
    "node": "v24.19.0",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "cpuCount": 16,
    "memoryBytes": 33576542208
  },
  "reference": false,
  "samples": 7,
  "consumer": {
    "kind": "self",
    "root": "/tmp/concord-bench-KAkIDg/self",
    "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
    "cache": "ready"
  },
  "artifacts": [
    {
      "label": "candidate",
      "dir": "/tmp/concord-hawdb-release",
      "entry": "/tmp/concord-hawdb-release/dist/entry.js",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "dirty": true,
      "digest": "sha256:7beb4ea05fae6210e3a59399430ce2f148b9ec6f02dbc926c9122818d2bad4b9"
    },
    {
      "label": "baseline",
      "dir": "/tmp/concord-hawdb013-baseline",
      "entry": "/tmp/concord-hawdb013-baseline/dist/entry.js",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "dirty": false,
      "digest": "sha256:1a698f8b3aa5879ee57aaa3b17d91af0030226cd2e1637c0dee79075f844ea5c"
    }
  ],
  "consumers": {
    "candidate": {
      "kind": "self",
      "root": "/tmp/concord-bench-KAkIDg/self",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "cache": "ready"
    },
    "baseline": {
      "kind": "self",
      "root": "/tmp/concord-bench-KAkIDg/baseline/self",
      "commit": "1a16741d153ccd18e88757202c7c374b01dc978d",
      "cache": "ready"
    }
  },
  "verdicts": [
    {
      "command": "concord --json --fresh --dry-run trace gaps",
      "candidate": {
        "samples": [
          3136.018253,
          3151.901515999998,
          3207.137204999999,
          3008.9294620000037,
          3123.3846360000025,
          3089.2045300000027,
          3161.013196
        ],
        "p50": 3136.018253,
        "max": 3207.137204999999,
        "valid": true
      },
      "baseline": {
        "samples": [
          3163.9500989999997,
          3180.938814000001,
          3220.9282840000014,
          2937.6388819999993,
          3155.29666,
          3197.956059999997,
          3172.2435750000004
        ],
        "p50": 3172.2435750000004,
        "max": 3220.9282840000014,
        "valid": true
      },
      "regression": -0.01,
      "limitMs": 120000,
      "limitKind": "max",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord --json --fresh --dry-run trace show docs/feature/local-sdlc/README.md",
      "candidate": {
        "samples": [
          3179.116540999996,
          3111.9656479999976,
          3185.3763710000057,
          3214.2618809999985,
          3179.387770000001,
          3259.5488179999957,
          3228.4460180000024
        ],
        "p50": 3185.3763710000057,
        "max": 3259.5488179999957,
        "valid": true
      },
      "baseline": {
        "samples": [
          3261.2030039999954,
          3210.832287000012,
          3191.250893999997,
          3356.5432010000077,
          3213.763845999987,
          3171.675151999996,
          3098.8041660000017
        ],
        "p50": 3210.832287000012,
        "max": 3356.5432010000077,
        "valid": true
      },
      "regression": -0.01,
      "limitMs": 120000,
      "limitKind": "max",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord --json --fresh --dry-run review render local-sdlc",
      "candidate": {
        "samples": [
          3206.229587000009,
          3232.419246999998,
          3188.9581550000003,
          3243.573848,
          3275.03831600002,
          3139.3588220000092,
          3186.1076900000044
        ],
        "p50": 3206.229587000009,
        "max": 3275.03831600002,
        "valid": true
      },
      "baseline": {
        "samples": [
          3211.1508170000016,
          3216.1283780000085,
          3251.2605660000117,
          3196.820683000027,
          3215.757821999985,
          3191.957411999989,
          3230.663321
        ],
        "p50": 3215.757821999985,
        "max": 3251.2605660000117,
        "valid": true
      },
      "regression": 0,
      "limitMs": 120000,
      "limitKind": "max",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord trace gaps",
      "candidate": {
        "samples": [
          526.199289000011,
          581.1315689999901,
          455.3516459999955,
          537.6175070000172,
          502.8754949999857,
          495.92232100002,
          475.96283999999287
        ],
        "p50": 502.8754949999857,
        "max": 581.1315689999901,
        "valid": true
      },
      "baseline": {
        "samples": [
          514.9426979999989,
          419.8933290000132,
          499.18311499999254,
          516.8610430000117,
          475.8451010000135,
          477.2078399999882,
          586.0300399999833
        ],
        "p50": 499.18311499999254,
        "max": 586.0300399999833,
        "valid": true
      },
      "regression": 0.01,
      "limitMs": 600,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord trace show docs/feature/local-sdlc/README.md",
      "candidate": {
        "samples": [
          506.0724599999958,
          597.5059020000044,
          581.0198010000167,
          492.2689600000158,
          541.0209759999998,
          540.4248030000017,
          495.3185850000009
        ],
        "p50": 540.4248030000017,
        "max": 597.5059020000044,
        "valid": true
      },
      "baseline": {
        "samples": [
          556.1563489999971,
          487.5335710000072,
          475.7356700000237,
          505.72236499999417,
          522.5623339999875,
          652.9037589999789,
          472.36589499999536
        ],
        "p50": 505.72236499999417,
        "max": 652.9037589999789,
        "valid": true
      },
      "regression": 0.07,
      "limitMs": 600,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    },
    {
      "command": "concord review render local-sdlc",
      "candidate": {
        "samples": [
          553.4812539999839,
          571.7698640000017,
          529.3072589999938,
          554.1722109999973,
          497.54804999998305,
          566.4746400000004,
          518.8885890000092
        ],
        "p50": 553.4812539999839,
        "max": 571.7698640000017,
        "valid": true
      },
      "baseline": {
        "samples": [
          558.3150090000127,
          505.60867499999586,
          440.3577430000005,
          491.62131200000294,
          473.8462200000067,
          441.15993900000467,
          526.5030410000181
        ],
        "p50": 491.62131200000294,
        "max": 558.3150090000127,
        "valid": true
      },
      "regression": 0.13,
      "limitMs": 600,
      "limitKind": "p50",
      "withinLimit": true,
      "pass": true,
      "reasons": []
    }
  ],
  "snapshots": [
    {
      "command": "concord trace gaps",
      "artifact": "candidate",
      "readyAfterMs": 4892.268393999984
    },
    {
      "command": "concord trace gaps",
      "artifact": "baseline",
      "readyAfterMs": 4891.337790999998
    },
    {
      "command": "concord trace show docs/feature/local-sdlc/README.md",
      "artifact": "candidate",
      "readyAfterMs": 5240.31416899999
    },
    {
      "command": "concord trace show docs/feature/local-sdlc/README.md",
      "artifact": "baseline",
      "readyAfterMs": 5030.126971999998
    },
    {
      "command": "concord review render local-sdlc",
      "artifact": "candidate",
      "readyAfterMs": 5308.235108999972
    },
    {
      "command": "concord review render local-sdlc",
      "artifact": "baseline",
      "readyAfterMs": 5077.4309559999965
    }
  ],
  "pass": true,
  "acceptance": true
}
```
