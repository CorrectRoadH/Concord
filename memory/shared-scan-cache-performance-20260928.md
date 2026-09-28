---
format: concord.document/v1
id: shared-scan-cache-performance-20260928
title: 共享扫描与缓存性能复测
createdAt: 2026-09-28T02:46:16.631Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# 共享扫描与缓存性能复测

本轮针对 Web workspace 持续 13–17 秒及缓存 ready 仍慢的观察，修正公共扫描层；没有消费者 macOS/rpg-game 的实际复现材料，不宣称该现场已完成验收。旧日志的 cache-unavailable 缺少具体原因，不能据此判为某种锁或安装故障。

## 瓶颈与处理

缓存命中不省略当前来源读取与安全校验。原生 get 批次逐键执行 SQL；文档诊断逐文件维护缓存；多个代码关系反复读取相同目标。集合查询改为有界 namespace 扫描后选择键，诊断按批解析与写入并逐文件保留失败，写入同时满足条数及 UTF-8 字节预算。相同引用按本次编译复用，返回前复核读取的原文字节与安全路径。

静态配置使用进程期 HawDB 解析缓存，减少 Web 请求重开持久库；文档与配置分配 15 MiB/9872 条和 1 MiB/128 条，合计保持既定 16 MiB/10000 条，总逻辑预算仍为 36 MiB。源码读取移除紧邻 read/files 的重复 absolute 校验；路径检查合并重复 lstat，macOS 精确字节比较只分配一次 requested Buffer。写作范围索引只枚举一次目录。没有测试标记候选的文本不构建 JS/TS AST。

命中仍严格解码，包括 present:false 的值，不允许不存在的必需值绕过 Schema。日志增加 annotations/code 的命中数、未命中数与受限错误码，以及 Trace/源码读取/缓存解析/来源核验阶段；不输出原始错误或路径。

## 测量身份与方法

基线为 HEAD a9b6054d4a29c857400bd2942a5972dd5e841fd9 的重新构建产物，逐项核对 364 个 JS/native/manifest 文件。起初保存的 dist 含旧 macOS deployment target 元数据；最终全部对照已使用重新构建的 HEAD 基线重跑。native 二进制未变，基线构建通过 CONCORD_NATIVE_ARTIFACTS 引用同源受检本机产物。pnpm --dir 的依赖状态检查拒绝共享 node_modules 后，使用同一 build.ts 经 node --import tsx 构建，未重装或修改共享依赖。

平台 Linux x64，AMD Ryzen 7 5800X，Node v24.19.0。冻结消费者 commit 85c3ea84dd74dda52faee7fb1b4a270e559a844d，1112 个源码文件、110 个生成支持页面。全部采样为同机交错七对，CLI 每次新进程且各命令分别预热一次，HTTP 独立客户端/服务进程且每个进程预热后测一次；输出事实一致。正常与原生产物摘要不匹配回源分别测量。冷启动先通过公开 CLI cache clear，仅记录首次请求。

CLI 命令：node <artifact>/dist/entry.js --root <consumer> --json <command>。Web：pnpm exec tsx scripts/measure-view-requests.ts <artifact> <consumer> <output.json> 1，轮换基线与候选七次；并发 action 是相同正文的 document.set。所有最大值不超过本组 p50 两倍，各路由/命令无超过 20% 的回退。这是同机对照，不替代其它规模或平台的绝对预算验收。

| 操作 | 基线 p50 ms | 候选 p50 ms | 变化 |
| --- | ---: | ---: | ---: |
| CLI feature list | 427.38 | 414.95 | -2.9% |
| CLI memory index | 389.34 | 388.99 | -0.1% |
| CLI issue list | 413.12 | 415.31 | +0.5% |
| CLI trace check | 918.90 | 626.03 | -31.9% |
| CLI check | 1033.54 | 760.62 | -26.4% |
| HTTP view/workspace | 485.26 | 274.88 | -43.4% |
| HTTP view/jobs | 470.74 | 260.36 | -44.7% |
| HTTP view/file | 558.66 | 326.83 | -41.5% |
| HTTP view/action | 769.22 | 431.00 | -44.0% |
| HTTP fallback/workspace | 417.48 | 289.82 | -30.6% |
| HTTP fallback/jobs | 401.03 | 275.08 | -31.4% |
| HTTP fallback/file | 481.93 | 342.86 | -28.9% |
| HTTP fallback/action | 611.86 | 450.26 | -26.4% |

冷首次 workspace：基线 1683.80 ms，候选 1396.74 ms。CLI check 的全部暖样本代码缓存均为 hit，hits=1112、misses=0，说明性能差异不来自人为关闭缓存或漏扫来源。

## 验证与边界

pnpm typecheck 通过（构建、测试类型和脚本类型）；最终定向 69 项全部通过：annotations、code-cache、content-cache、documents、editing、runtime-portability、scoped-writing、trace-gaps、ts-only-runtime、view-performance、view-request-log、cli-startup。覆盖真实 HawDB 损坏条目、逐文件失败、字节限额、外部同长度编辑、删除、引用复核期间编辑/符号链接替换及 HTTP 日志脱敏。

完整 pnpm check 曾运行两轮，最后一轮 300 项：297 通过、1 失败、2 跳过。唯一失败在 test/code-cli.test.ts:178：本轮开始前已有 README 修改，把 Quick start 改为依赖既有 Git 仓库，而测试仍在非 Git 临时目录执行，返回 GitFailed。保留 README.md 与 README.zh-CN.md 已有改动，未改写示例或放宽测试。其后的缓存额度及缺失值 Schema 修补由上述最终类型检查和 69 项针对性测试验证，不能把完整检查描述为全绿。

concord check --json 返回 ok:true、complete:true、findings:[]。未发布、未 push、未触及 macOS 消费者；主线程仍同步执行扫描，优化减少工作量，不宣称扫描期间所有 HTTP 请求完全无阻塞。

## 原始测量数据

```json
{
  "cli": {
    "node": "v24.19.0",
    "platform": "linux",
    "consumer": "/tmp/concord-perf-fix-consumer",
    "samples": [
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 431.3242359999999
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 414.945117
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 414.5647720000002
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 421.65118299999995
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 421.9848320000001
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 414.60720699999956
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 412.22158500000023
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 432.54957099999956
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 427.38179800000034
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 415.4304890000003
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 422.7546249999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 435.4569529999999
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "feature list",
        "ms": 423.8087580000001
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "feature list",
        "ms": 424.0927160000001
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 389.34417999999914
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 389.3971110000002
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 387.4592369999991
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 395.0643990000008
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 391.4812129999991
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 388.993140999999
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 386.0007650000007
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 388.29935900000055
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 387.0993290000006
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 386.4097469999997
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 391.1761889999998
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 391.1318279999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "memory index",
        "ms": 387.37897899999916
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "memory index",
        "ms": 393.7288600000011
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 411.2277269999995
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 415.4584269999996
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 412.1842090000009
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 414.6770949999991
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 412.4019669999998
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 431.59167199999865
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 415.112000000001
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 409.8990640000011
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 414.77000599999883
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 412.1113489999989
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 422.65503499999977
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 416.3456810000025
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "issue list",
        "ms": 413.11938100000043
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "issue list",
        "ms": 415.3056639999995
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 896.2145149999997
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 621.8602370000008
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 632.3876469999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 918.9030249999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 905.9765729999999
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 621.0642399999997
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 638.4673079999993
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 920.0003319999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 906.3951660000021
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 627.4334970000018
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 623.363784000001
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 919.4015459999973
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "trace check",
        "ms": 940.8111949999984
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "trace check",
        "ms": 626.0256499999996
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 1033.5743779999975,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 775.6926000000021,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 770.4040870000026,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 1058.0167310000033,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 1071.7183179999993,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 776.7024450000026,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 760.6195989999978,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 1033.5386760000038,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 969.4868429999988,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 725.196901999996,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 690.779008999998,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 948.2001430000018,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/tmp/concord-perf-baseline",
        "command": "check",
        "ms": 940.6521989999965,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      },
      {
        "artifact": "/home/ctrdh/Code/Concord",
        "command": "check",
        "ms": 721.8527210000029,
        "codeCache": {
          "status": "hit",
          "hits": 1112,
          "misses": 0
        },
        "annotationCache": "hit"
      }
    ]
  },
  "http": {
    "view": {
      "before": [
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 847.91,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 439.32,
              "jobs": 424.58,
              "file": 508.84,
              "action": 713.02
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 947.25,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 488.29,
              "jobs": 474.2,
              "file": 561.16,
              "action": 769.22
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 918.63,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 485.26,
              "jobs": 470.74,
              "file": 565.26,
              "action": 787.73
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 922.66,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 493.52,
              "jobs": 479.31,
              "file": 573.86,
              "action": 787.78
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 906.26,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 443.73,
              "jobs": 429.39,
              "file": 527.86,
              "action": 727.64
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 921.96,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 487.84,
              "jobs": 471.95,
              "file": 558.66,
              "action": 773.49
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline",
          "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 932.73,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 464.03,
              "jobs": 444.92,
              "file": 537.97,
              "action": 755.11
            }
          ]
        }
      ],
      "after": [
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 548.86,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 277.4,
              "jobs": 262.27,
              "file": 327.43,
              "action": 431
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 550.87,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 271.42,
              "jobs": 256.9,
              "file": 322.86,
              "action": 423.22
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 550.91,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 271.82,
              "jobs": 256.72,
              "file": 326.83,
              "action": 427.92
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 546.18,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 278,
              "jobs": 263.27,
              "file": 333.75,
              "action": 438.24
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 555.35,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 274,
              "jobs": 259.19,
              "file": 324.92,
              "action": 429.25
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 552.1,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 274.88,
              "jobs": 260.39,
              "file": 326.74,
              "action": 431.54
            }
          ]
        },
        {
          "artifact": "/home/ctrdh/Code/Concord",
          "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 569.18,
          "complete": true,
          "findings": [],
          "cache": "hit",
          "samples": [
            {
              "workspace": 275.13,
              "jobs": 260.36,
              "file": 328.81,
              "action": 433.76
            }
          ]
        }
      ]
    },
    "fallback": {
      "before": [
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 725.05,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 417.48,
              "jobs": 401.03,
              "file": 481.93,
              "action": 608.25
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 700.86,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 418.32,
              "jobs": 401.9,
              "file": 503.79,
              "action": 653.29
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 707.95,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 416.7,
              "jobs": 400.64,
              "file": 476.65,
              "action": 600.21
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 690.27,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 408.97,
              "jobs": 394.61,
              "file": 477.45,
              "action": 614.51
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 698.17,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 402.43,
              "jobs": 385.55,
              "file": 464.31,
              "action": 604.33
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 696.3,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 418.94,
              "jobs": 403.13,
              "file": 484.88,
              "action": 615.15
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-baseline-unavailable",
          "artifactDigest": "7dd08b4efe1c202971e30552c273117d6473530ecc4f0028b92db1382712e1ea",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 693.96,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 419.03,
              "jobs": 404.42,
              "file": 487.23,
              "action": 611.86
            }
          ]
        }
      ],
      "after": [
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 577.73,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 298.36,
              "jobs": 283.22,
              "file": 353.72,
              "action": 455.06
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 588.41,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 289.78,
              "jobs": 275.08,
              "file": 342.86,
              "action": 447.74
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 581.86,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 281.84,
              "jobs": 265.95,
              "file": 336.65,
              "action": 437.13
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 582.05,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 288.09,
              "jobs": 273.26,
              "file": 342.65,
              "action": 450.26
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 589.83,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 290.32,
              "jobs": 274.51,
              "file": 350.02,
              "action": 459.86
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 589.95,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 294.55,
              "jobs": 279.81,
              "file": 348.83,
              "action": 460.26
            }
          ]
        },
        {
          "artifact": "/tmp/concord-perf-candidate-unavailable",
          "artifactDigest": "515922e4d87ed9ad6702c80e57401e13a9c87603f57c77bef4b54729523a9043",
          "platform": "linux",
          "arch": "x64",
          "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
          "root": "/tmp/concord-perf-fix-consumer",
          "node": "v24.19.0",
          "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
          "scale": {
            "sourceFiles": 1112,
            "supportingPages": 110
          },
          "firstRequestMs": 582.13,
          "complete": true,
          "findings": [],
          "cache": "unavailable",
          "samples": [
            {
              "workspace": 289.82,
              "jobs": 275.16,
              "file": 342.62,
              "action": 443.65
            }
          ]
        }
      ]
    }
  },
  "cold": {
    "before": {
      "artifact": "/tmp/concord-perf-baseline",
      "artifactDigest": "47d51167a05815bbdee304e8d1b4ea43462a0e46c724a9547b6964e9cc35247c",
      "platform": "linux",
      "arch": "x64",
      "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
      "root": "/tmp/concord-perf-fix-consumer",
      "node": "v24.19.0",
      "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
      "scale": {
        "sourceFiles": 1112,
        "supportingPages": 110
      },
      "firstRequestMs": 1683.8,
      "complete": true,
      "findings": [],
      "cache": "miss",
      "samples": [
        {
          "workspace": 497.26,
          "jobs": 481.43,
          "file": 572.65,
          "action": 782.26
        }
      ]
    },
    "after": {
      "artifact": "/home/ctrdh/Code/Concord",
      "artifactDigest": "d8f6167d8bd7d146975e13870c15ff95c37beb60ce59d48b67bef2a8fb53a160",
      "platform": "linux",
      "arch": "x64",
      "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
      "root": "/tmp/concord-perf-fix-consumer",
      "node": "v24.19.0",
      "commit": "85c3ea84dd74dda52faee7fb1b4a270e559a844d",
      "scale": {
        "sourceFiles": 1112,
        "supportingPages": 110
      },
      "firstRequestMs": 1396.74,
      "complete": true,
      "findings": [],
      "cache": "miss",
      "samples": [
        {
          "workspace": 277.17,
          "jobs": 262.11,
          "file": 329.01,
          "action": 458.21
        }
      ]
    }
  }
}
```
