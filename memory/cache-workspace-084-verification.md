---
format: concord.document/v1
id: cache-workspace-084-verification
title: 0.8.4 缓存恢复与工作区扫描验收
createdAt: 2026-09-28T05:03:52.415Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 0.8.4 缓存恢复与工作区扫描验收

下游报告的目录检查拒绝来自 TS clear inspection 与原生 inspect_tree 两处固定上限（4096 条目、256 MiB），不是事实数据超过业务容量。去除目录总量拒绝，保留路径、链接、所有权和单次内存操作边界。

工作区扫描放入受 OwnedProcess 管理的常驻子进程。每代重开仓库并关闭资源，父进程确认 token 已释放才交付；取消最后等待者会终止进程并在确认进程组退出后清理精确 token。对公共发布租约只在首次 admission 回收已确认死亡的观察集；后续最多等三秒，不回收等待期间新到达的 owner。

压力验证发现被中断的 HawDB 写入可能需要可写日志恢复，普通只读打开报缺少已发布行增量。启用缓存的工作区扫描针对固定引擎的该错误，existing-only 重开、checkpoint、重新只读验证；不删除缓存。真实 SIGKILL 回归检查已提交缓存项保留。

初版每次新建扫描进程的 workspace p50 为 782ms，对照 396ms，未通过 20% 门槛，未采用。常驻进程最终复测见下方完整样本，workspace 与竞争文件请求改善，code/test list 未超过回退门槛。

基线为父提交 fd4cc7f8ebbcc1ae3fadc11aa7d52be0c49cbfcc 的修改前构建目录；候选为 v0.8.4 修复工作树构建。脚本 scripts/measure-workspace.ts 创建并提交冻结 Git 消费者，1072 个 src 与 1072 个 test 文件，分别预热一次、同机交错七轮。HTTP 计时包含完整响应读取；竞争文件请求原定在扫描发起后 50ms 执行，其延迟包含事件循环阻塞。CLI 为每轮新进程从启动到退出。

此测量在 Linux 上完成，不能替代用户 macOS 仓库验收。完整发布验证结果另由检查日志和发布流水线记录。

```json
{
  "node": "v24.19.0",
  "platform": "linux",
  "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
  "memoryBytes": 33576538112,
  "fixtureCommit": "14b76aea379d4a35a0feddbffef27ad6930e1237",
  "sourceFiles": 1072,
  "testFiles": 1072,
  "samples": {
    "baseline": [
      {
        "workspaceMs": 423.2209220000004,
        "competingRequestMs": 371.34177999999974
      },
      {
        "workspaceMs": 400.51314900000034,
        "competingRequestMs": 348.68061899999975
      },
      {
        "workspaceMs": 401.9860399999998,
        "competingRequestMs": 350.31848400000035
      },
      {
        "workspaceMs": 397.5120569999999,
        "competingRequestMs": 345.7173279999997
      },
      {
        "workspaceMs": 394.97821900000054,
        "competingRequestMs": 343.65253200000006
      },
      {
        "workspaceMs": 394.8832259999999,
        "competingRequestMs": 343.05977600000006
      },
      {
        "workspaceMs": 405.4046449999987,
        "competingRequestMs": 353.92019399999845
      }
    ],
    "candidate": [
      {
        "workspaceMs": 313.37167800000043,
        "competingRequestMs": 59.1320139999998
      },
      {
        "workspaceMs": 304.78284299999996,
        "competingRequestMs": 59.178556000000754
      },
      {
        "workspaceMs": 304.70256100000006,
        "competingRequestMs": 57.22746199999983
      },
      {
        "workspaceMs": 302.17570200000046,
        "competingRequestMs": 61.34876499999973
      },
      {
        "workspaceMs": 301.5014229999997,
        "competingRequestMs": 59.27745899999991
      },
      {
        "workspaceMs": 306.6183339999998,
        "competingRequestMs": 57.82896900000014
      },
      {
        "workspaceMs": 306.03330800000003,
        "competingRequestMs": 57.832118999998784
      }
    ]
  },
  "cliSamples": {
    "code": {
      "baseline": [
        669.7368989999995,
        631.8994810000004,
        591.5453350000007,
        623.1519819999994,
        681.9473259999995,
        632.4866099999999,
        686.7077989999998
      ],
      "candidate": [
        638.3686690000013,
        560.8215519999994,
        563.892135,
        659.9029520000004,
        634.120745000002,
        645.849216999999,
        653.8430769999977
      ]
    },
    "test": {
      "baseline": [
        532.1963690000011,
        533.6956799999971,
        537.6183880000026,
        530.0065099999993,
        532.385835000001,
        535.949614000001,
        520.7620079999979
      ],
      "candidate": [
        526.3699990000023,
        531.979242999998,
        516.670173999999,
        535.2597239999996,
        533.4457849999999,
        515.6541259999976,
        516.0585680000004
      ]
    }
  }
}
```

baseline dist 文件树 SHA-256（排序相对路径 + NUL + 各文件原始 SHA-256 串联）：`6330958d9ca9072b7e4e7f94dcb58e40e77974d2a0950d7b9b86d522fbd9050f`。

candidate dist 文件树 SHA-256（排序相对路径 + NUL + 各文件原始 SHA-256 串联）：`1b90bf3831f82b17d33e2bcf5bebaf095c0f489e7c6eccb50a0d8edb75500ea3`。

## 验证记录

`nix shell nixpkgs#gcc --command pnpm check`：313 tests，311 pass，0 fail，2 skipped；包含构建、类型检查、打包安装消费者与浏览器入口。另以 `node --import tsx --test --test-name-pattern='interrupted WAL' test/hawdb-cache.test.ts` 验证 cache-off 不恢复、cache-use 恢复且保留已提交项，通过。

独立 Grok 4.7 生命周期审查确认 root fiber、IPC 代际、精确 token 验证与进程组清理通过；本记录不把单次进程的被否决方案记为采用。

## 下游安装体积

对同一 Linux 环境，分别 npm pack 修改前基线目录和候选目录，再在独立空目录执行 npm install --ignore-scripts --omit=dev --offline --no-audit --no-fund。统计 node_modules 内非符号链接普通文件的数量及逻辑字节，安装临时目录已回收。

基线 9849 文件、183685542 字节；候选 8100 文件、143992726 字节。文件总字节减少约 21.6%。此数字不是 macOS Homebrew Cellar 的实际占用；p5 浏览器运行库和编译所需声明随 dist 提供，避免重复安装完整 p5 及其生产依赖。
