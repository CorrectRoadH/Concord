---
format: concord.document/v1
id: view-native-failure-latency
title: View 慢请求与原生产物失败退避
createdAt: 2026-09-27T08:13:54.107Z
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---

# View 慢请求与原生产物加载失败

## 结论

load 只缓存成功时，安装产物摘要失败导致每次文档纯解析缓存查询重新读取和 SHA256 整个 native binary。同步工作占用 HTTP 事件循环；jobs 本身只访问内存也会在接纳前排队。失败保留单个记录并退避一秒，后续继续严格验证。该改动不缓存来源事实、不绕过一致性或发布租约。

慢日志在 stderr 输出，250 ms 处理或事件循环采样延迟触发，每分钟最多20条，stderr积压64KiB跳过，有限阶段与原因；不记录正文/查询/路径参数/原始异常。事件循环采样不是单个请求精确排队时间。

## 测量边界

在任务开始已存在的 dirty 构建产物上冻结 before（不是 Git 父提交，不能用于声明 CLI 父提交性能预算通过）；after仅新增请求计时与 native失败退避。独立 HTTP 客户端与服务进程，冻结 Git消费者1112源码文件、110支持页面；每进程冷请求一次后一个并发样本，七组before/after交错。无其它测试并行。故障通过向隔离产物hawdb.node追加字节制造，正常组恢复同一原生产物。未操作RPG。每次document.set使用相同正文及真实摘要。

所有响应200且complete:true/findings:[]，包括cache unavailable。HTTP200不代表完整性；真实HTTP回归通过尾部文件标注制造OrphanCodeAnnotation，返回200/complete:false，修正后完整。CodeSourceChanged是来源变化的保护；延长扫描增加相遇窗口，不能据此删除该保护。

## 验证与限制

pnpm check完成构建、类型检查与292测试，289通过、2跳过；新增HTTP夹具首次缺关联引出另一个诊断而失败，修正后定向复测1/1通过。安装消费者验证100次native故障只读一次binary，修复安装并等待1.1秒后恢复。最终 pnpm check 重跑通过：293 测试、291 通过、0 失败、2 既有跳过，218.15 秒；包含新增路径菜单与反馈筛选的打包CLI/HTTP/浏览器验证。产品check ok:true complete:true findings:[]。Mac现场未测，原始安装摘要问题仍需修复安装，cache clear不能修复binary。同步扫描仍存在，故障改善不是任意规模低延迟保证。

## 汇总（毫秒）

```json
{
  "unavailable": {
    "before": {
      "workspace": {
        "p50": 2862,
        "max": 2953.84
      },
      "jobs": {
        "p50": 2851.25,
        "max": 2943.91
      },
      "file": {
        "p50": 3011.71,
        "max": 3103.1
      },
      "action": {
        "p50": 3223.81,
        "max": 3300.67
      }
    },
    "after": {
      "workspace": {
        "p50": 424.1,
        "max": 436.03
      },
      "jobs": {
        "p50": 414.66,
        "max": 426.33
      },
      "file": {
        "p50": 486.69,
        "max": 505.44
      },
      "action": {
        "p50": 609.76,
        "max": 631.05
      }
    }
  },
  "healthy": {
    "before": {
      "workspace": {
        "p50": 467.68,
        "max": 498.47
      },
      "jobs": {
        "p50": 452.1,
        "max": 484.01
      },
      "file": {
        "p50": 537.62,
        "max": 577.07
      },
      "action": {
        "p50": 745.46,
        "max": 791.61
      }
    },
    "after": {
      "workspace": {
        "p50": 489.77,
        "max": 502.03
      },
      "jobs": {
        "p50": 475.43,
        "max": 487.04
      },
      "file": {
        "p50": 570.84,
        "max": 575.93
      },
      "action": {
        "p50": 780.29,
        "max": 792.39
      }
    }
  }
}
```

## 原始样本与身份

```json
[
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 919.75,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 460.02,
        "jobs": 445.53,
        "file": 538.98,
        "action": 737.2
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 937.47,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 500.7,
        "jobs": 485.27,
        "file": 574.69,
        "action": 792.39
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 950.84,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 498.72,
        "jobs": 484.32,
        "file": 571.37,
        "action": 778.69
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 830.2,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 461.79,
        "jobs": 446.23,
        "file": 533.16,
        "action": 728.96
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 961.2,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 489.77,
        "jobs": 475.43,
        "file": 570.84,
        "action": 784.31
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 849.7,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 486.44,
        "jobs": 471.31,
        "file": 563.03,
        "action": 780.29
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 941.75,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 502.03,
        "jobs": 487.04,
        "file": 575.93,
        "action": 785.83
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 1794.92,
    "complete": true,
    "findings": [],
    "cache": "miss",
    "samples": [
      {
        "workspace": 491.93,
        "jobs": 475.95,
        "file": 568.34,
        "action": 791.61
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 933.04,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 498.47,
        "jobs": 484.01,
        "file": 577.07,
        "action": 789.76
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 897.18,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 431.59,
        "jobs": 415.8,
        "file": 502.01,
        "action": 695.22
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 834.34,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 467.68,
        "jobs": 452.1,
        "file": 537.62,
        "action": 745.46
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 820.95,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 437.19,
        "jobs": 422.19,
        "file": 505.76,
        "action": 702.07
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 909.71,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 492.79,
        "jobs": 477.6,
        "file": 571.34,
        "action": 778.99
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 891.53,
    "complete": true,
    "findings": [],
    "cache": "hit",
    "samples": [
      {
        "workspace": 442.85,
        "jobs": 426.93,
        "file": 512.64,
        "action": 707.83
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 712.42,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 424.1,
        "jobs": 414.66,
        "file": 486.69,
        "action": 609.76
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 705.18,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 436.03,
        "jobs": 426.33,
        "file": 503.28,
        "action": 627.46
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 698.49,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 420.69,
        "jobs": 404.89,
        "file": 477.67,
        "action": 579.68
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 696.75,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 423.45,
        "jobs": 413.6,
        "file": 486.5,
        "action": 591.38
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 678.08,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 373.31,
        "jobs": 358.31,
        "file": 432.75,
        "action": 536.5
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 704.23,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 431.22,
        "jobs": 420.36,
        "file": 492.91,
        "action": 621.89
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-candidate-kx23nz3y",
    "artifactDigest": "5e0cd379d766773a2a24d25ae5224d34b7600181633114d4ceba2d1d6ffbebe9",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 721.17,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 435.11,
        "jobs": 424.47,
        "file": 505.44,
        "action": 631.05
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3151.11,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2860.52,
        "jobs": 2849.67,
        "file": 3002.17,
        "action": 3189.52
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3193.73,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2862,
        "jobs": 2851.25,
        "file": 3011.71,
        "action": 3223.81
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3148.68,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2926.35,
        "jobs": 2916.4,
        "file": 3073.65,
        "action": 3265.86
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3170.87,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2696.19,
        "jobs": 2686.28,
        "file": 2847.91,
        "action": 3034.26
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3235.9,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2953.11,
        "jobs": 2942.3,
        "file": 3099.77,
        "action": 3286.08
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3247.28,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2845.83,
        "jobs": 2834.98,
        "file": 2995.88,
        "action": 3188.94
      }
    ]
  },
  {
    "artifact": "/tmp/concord-view-baseline-ryo3tu4l",
    "artifactDigest": "f4f7cd22c45084de88550e0e4d6a1b0b552a5ef71694a55b5c026d57163ddfb6",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "root": "/tmp/concord-view-request-consumer",
    "node": "v24.19.0",
    "commit": "1dd3d4080d957c3da7baad051af5c412a237a376",
    "scale": {
      "sourceFiles": 1112,
      "supportingPages": 110
    },
    "coldMs": 3296.54,
    "complete": true,
    "findings": [],
    "cache": "unavailable",
    "samples": [
      {
        "workspace": 2953.84,
        "jobs": 2943.91,
        "file": 3103.1,
        "action": 3300.67
      }
    ]
  }
]
```
