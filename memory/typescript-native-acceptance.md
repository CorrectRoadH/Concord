---
format: concord.document/v1
id: typescript-native-acceptance
title: 四项方案集成与 TS7 优化验收
createdAt: 2026-10-21T13:56:13.649Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

2026-10-21 完成四项采用方案的集成、编辑器服务与 TypeScript 7.1.0-beta 原生同步 API 迁移。设计经原生 Codex / GPT-6.1 Sol 独立审查，主 agent 完成集成与验收；本轮 Herdr worker pane/tab 已全部回收。

## 验证与边界

主工作区 `pnpm check` 记录 491 tests：480 pass、4 fail、6 skipped、1 todo。该轮产物早于最后的 writing findings cache 与 trace resolver 复用修正。最终 `pnpm typecheck` 通过；最终构建上的 writing-cache、controlled-writing、scoped-writing、editor-lsp、trace-gaps、cli-startup、code-cache 共 41/41 通过，steps writing 实际入口补验 1/1 通过，无 todo。原 C11 占位已由该实际入口覆盖。

四项全量失败中：neutral-native-cli 是离线缓存缺少 Vite 8.3.5，正常包管理器补齐后真实打包消费者 1/1 通过；trace 重复读取在正式最终构建复验通过。剩余 operation-boundaries-browser 的 blocked recovery 与 workspace-watch-browser 的 health unknown 两项在改动前基线均失败，本轮未修改其代码，不声称全量检查通过。

Cargo 首次因 cc 不在 PATH 跳过，补入本机 GCC 后发现 rustup LLD 包装器引用已删除的 Nix 路径。仅测试进程使用现有 gcc-wrapper 与 RUSTFLAGS=-C link-arg=-fuse-ld=bfd 后，真实打包 Vitest、pytest、Go、Cargo、Node 用例全部通过，无跳过。其余跳过是三个 Darwin 专属用例与两个未启用的 native test-hook 用例；不声称跨平台或 native hook 覆盖。编辑器取消、超时、真实原生编译器进程组回收、永久 cleanup-failure latch，以及 EOF 后才出现的清理失败均已验证。

## 性能

按采用方案固定消费者、公开构建 CLI、预热后七个新进程、legacy 基线交错采样。消费者共 289 Markdown 文件、666845 bytes、121263 tokens。六组均有效且通过原有预算；self length docs/check 为 587/1404ms，self lexical docs/check 为 585/1424ms。legacy docs 为 597ms 对基线 1072ms，check 为 1437ms 对 1405ms（+2.25%，低于20%）。cold 单独记录；scale 按本轮范围未测，不将 self 成绩外推为 scale 验收。

写作性能通过复用经当前完整输入校验的 findings 达成。缓存保持严格 Schema、解析器版本、政策/术语合成校验、来源字节与成员复核；无效缓存重算，编辑器 overlay 禁止持久缓存。真实新 CLI 进程验证 cold 加载 prose parser、warm 不加载，cache-off 结果一致。

原始运行记录位于 /tmp/cd/ts7-main-full-check.log、/tmp/cd/ts7-final-typecheck.log、/tmp/cd/ts7-final-affected-tests.log、/tmp/cd/ts7-final-steps-writing.log、/tmp/cd/ts7-neutral-packed-recheck.log、/tmp/cd/ts7-adapters-bfd-recheck.log 与 /tmp/cd/ts7-writing-performance-final.json。这些是本次命令观察，不是原生测试覆盖率或持久 command receipt。

性能记录（包含产物摘要、消费者提交、样本与 cold）：

```json
{
  "environment": {
    "node": "v24.19.0",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 7 5800X 8-Core Processor",
    "cpuCount": 16,
    "memoryBytes": 33576542208
  },
  "referenceCommit": "36250cef0394d04eee75d88315bb133bae72d773",
  "artifacts": [
    {
      "label": "candidate",
      "dir": "/home/ctrdh/Code/Concord",
      "entry": "/home/ctrdh/Code/Concord/dist/entry.js",
      "commit": "efce8371f985e92b81ce5df7a4324fc99b4893ba",
      "dirty": true,
      "digest": "sha256:e23e81a6743251be7e31a847738c9d2f0725ecaa12ad47e168de5e31e77bd71d"
    },
    {
      "label": "baseline",
      "dir": "/home/ctrdh/Code/Concord-wt/integration",
      "entry": "/home/ctrdh/Code/Concord-wt/integration/dist/entry.js",
      "commit": "3ab75f73d474cbfa70a6e51e3edbc6036d9650de",
      "dirty": false,
      "digest": "sha256:266b0662e75f0bfaf1e97c6be6bdc98af4445fb5278a249ddc4ddea44ec80dc5"
    }
  ],
  "consumers": [
    {
      "name": "legacy-v2",
      "root": "/tmp/cd/ts7-writing-performance-cached/legacy-v2",
      "commit": "36250cef0394d04eee75d88315bb133bae72d773",
      "counts": {
        "files": 289,
        "bytes": 666845,
        "tokens": 121263,
        "sentences": 5194,
        "paragraphs": 2639,
        "codeTokens": 1888
      }
    },
    {
      "name": "legacy-v3",
      "root": "/tmp/cd/ts7-writing-performance-cached/legacy-v3",
      "commit": "451ca99feb7d02f9787a89084a6a625a5126120c",
      "counts": {
        "files": 289,
        "bytes": 666845,
        "tokens": 121263,
        "sentences": 5194,
        "paragraphs": 2639,
        "codeTokens": 1888
      }
    },
    {
      "name": "self-length",
      "root": "/tmp/cd/ts7-writing-performance-cached/self-length",
      "commit": "7afa9b61efbc87409ef101c44fce8cad22c598cb",
      "counts": {
        "files": 289,
        "bytes": 666845,
        "tokens": 121263,
        "sentences": 5194,
        "paragraphs": 2639,
        "codeTokens": 1888
      },
      "controlled": {
        "language": "auto",
        "sentence": {
          "zh": {
            "procedural": 320,
            "descriptive": 320
          },
          "en": {
            "procedural": 320,
            "descriptive": 320
          }
        },
        "paragraphSentences": 100
      }
    },
    {
      "name": "self-lexical",
      "root": "/tmp/cd/ts7-writing-performance-cached/self-lexical",
      "commit": "143e953c48c1c967b883558ea476ab4d0d6ccd7d",
      "counts": {
        "files": 289,
        "bytes": 666845,
        "tokens": 121263,
        "sentences": 5194,
        "paragraphs": 2639,
        "codeTokens": 1888
      },
      "controlled": {
        "language": "auto",
        "sentence": {
          "zh": {
            "procedural": 320,
            "descriptive": 320
          },
          "en": {
            "procedural": 320,
            "descriptive": 320
          }
        },
        "paragraphSentences": 100,
        "passiveVoice": {
          "zh": true,
          "en": true,
          "participles": [
            "cleared"
          ],
          "allowIn": {
            "zh": [
              "被"
            ]
          }
        }
      }
    }
  ],
  "groups": [
    {
      "name": "legacy interleaved",
      "args": [
        "docs",
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 1276.6175560000001,
          "exitCode": 0
        },
        {
          "artifact": "baseline",
          "ms": 1069.0912049999997,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            596.6856189999999,
            597.0846920000004,
            579.2484730000015,
            595.1689639999986,
            600.9119819999978,
            611.4299369999972,
            595.239537999998
          ],
          "p50": 596.6856189999999,
          "max": 611.4299369999972,
          "valid": true
        },
        "baseline": {
          "samples": [
            1072.2500629999995,
            1068.4111780000003,
            1092.5936770000008,
            1072.3974440000002,
            1073.422160000002,
            1061.7671750000009,
            1044.0433190000003
          ],
          "p50": 1072.2500629999995,
          "max": 1092.5936770000008,
          "valid": true
        }
      },
      "attempts": 1,
      "ratio": 0.5564799104143304,
      "failures": [],
      "pass": true
    },
    {
      "name": "legacy interleaved",
      "args": [
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 2932.6727290000017,
          "exitCode": 0
        },
        {
          "artifact": "baseline",
          "ms": 2821.9303739999996,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            1446.2738449999997,
            1429.6036230000027,
            1457.3268280000048,
            1290.6195989999978,
            1371.616550000006,
            1436.7982739999934,
            1444.2741370000003
          ],
          "p50": 1436.7982739999934,
          "max": 1457.3268280000048,
          "valid": true
        },
        "baseline": {
          "samples": [
            1405.8966529999998,
            1359.2598570000046,
            1382.201986,
            1225.7173770000009,
            1405.2183590000059,
            1425.3943289999952,
            1415.6047350000008
          ],
          "p50": 1405.2183590000059,
          "max": 1425.3943289999952,
          "valid": true
        }
      },
      "attempts": 1,
      "ratio": 1.022473315124107,
      "failures": [],
      "pass": true
    },
    {
      "name": "self length",
      "args": [
        "docs",
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 1400.305545000003,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            595.5337159999981,
            583.157683999998,
            585.883670999996,
            587.076350000003,
            590.9486210000032,
            587.1113659999974,
            592.1627709999957
          ],
          "p50": 587.1113659999974,
          "max": 595.5337159999981,
          "valid": true
        }
      },
      "attempts": 1,
      "limitMs": 1000,
      "failures": [],
      "pass": true
    },
    {
      "name": "self length",
      "args": [
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 3115.4339910000053,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            1463.324729,
            1508.8443759999936,
            1308.7757169999968,
            1367.7266260000033,
            1449.6124620000046,
            1381.260844999997,
            1404.129802999989
          ],
          "p50": 1404.129802999989,
          "max": 1508.8443759999936,
          "valid": true
        }
      },
      "attempts": 1,
      "limitMs": 2300,
      "failures": [],
      "pass": true
    },
    {
      "name": "self lexical",
      "args": [
        "docs",
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 1390.225403999997,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            588.2306280000048,
            568.5137099999993,
            597.8063229999971,
            572.5245500000019,
            576.3270829999965,
            585.1208670000051,
            591.1809919999941
          ],
          "p50": 585.1208670000051,
          "max": 597.8063229999971,
          "valid": true
        }
      },
      "attempts": 1,
      "limitMs": 1000,
      "failures": [],
      "pass": true
    },
    {
      "name": "self lexical",
      "args": [
        "check"
      ],
      "cold": [
        {
          "artifact": "candidate",
          "ms": 3169.9547639999946,
          "exitCode": 0
        }
      ],
      "stats": {
        "candidate": {
          "samples": [
            1517.0874100000074,
            1452.3622239999968,
            1376.4100600000093,
            1349.4717060000112,
            1353.1642920000013,
            1426.756474000009,
            1423.7395240000042
          ],
          "p50": 1423.7395240000042,
          "max": 1517.0874100000074,
          "valid": true
        }
      },
      "attempts": 1,
      "limitMs": 2300,
      "failures": [],
      "pass": true
    }
  ],
  "legacyEquivalent": true,
  "scale": "not measured",
  "samples": 7,
  "pass": true,
  "acceptance": true,
  "scope": "self controlled and equivalent legacy; scale excluded by task allowance"
}
```
