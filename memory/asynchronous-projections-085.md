---
format: concord.document/v1
id: asynchronous-projections-085
title: 0.8.5 异步诊断与短提交验收
createdAt: 2026-09-28T06:44:28.446Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 0.8.5 异步诊断与短提交

## 裁决与审查

采用无 publication owner 的乐观来源读取、普通写入的短期提交所有权，以及默认异步刷新的历史诊断。check、trace check、Memory/Issue 当前读取与证据不消费历史投影。journal、runner 与原生引擎所有权保持。

Grok 4.7 通过 Herdr 独立只读审查，首轮六项意见集中修正后复审 PASS，无剩余必修阻断。结果与错误改为单条原子 envelope；补齐失败记录、具名不可用、scannedAt 合并、等待中的请求与安装/配置身份核验；清理共享快照旧文案。超大文件缩小加入目录 size 观察。混版并发在既定不支持范围内，未采用引入新迁移边界的永久协议标记。最终把缓存读取重试上限从250ms调整为500ms，经主 agent 的完整预算测量验收；该数值调整发生在 reviewer 读取后，未改变通过的所有权和错误契约。

## 性能测量

参考消费者固定在 `6346f4cf78bc3553448a0119443f8f2ec681f5d5`，跟踪文件 614 个，其中 docs/ 237 个；测量不修改来源。基线父提交 `1cb7ebc`。Node v24.19.0，CPU AMD Ryzen 7 5800X 8-Core Processor。每组七个独立 CLI 进程，baseline/candidate 交替；均 max≤2×p50、全部预算通过、无超过20%的退化。cold 先 clear；warm 预热同一命令；输出重定向文件。

JS产物摘要：基线 7e1e4bd50ad84417e71459939866515fdde95ea6230557e95a90e149cca7aa3c，最终候选 e1c474802e7b9f9d3112f1c65aa94faac598a9acb2e2b38ca84d8033395a7708。原生最终 Linux 二进制摘要 5f748d9049129e566a1420a1242a5ddb1d1cdb441e1641695da569440bdef645。

| 命令 | 基线 p50 ms | 候选 p50 ms |
| --- | --- | --- |
| --help | 274 | 267 |
| --skill | 178 | 176 |
| memory index | 532 | 502 |
| memory list | 472 | 449 |
| memory recall HawDB | 534 | 498 |
| memory search HawDB | 541 | 504 |
| issue index | 520 | 490 |
| issue list | 518 | 479 |
| issue recall HawDB | 521 | 490 |
| feature list | 603 | 580 |
| docs check | 875 | 862 |
| trace show docs/feature/local-sdlc/README.md | 690 | 676 |
| trace check | 677 | 654 |
| check | 1014 | 980 |

历史参考仓库在 docs check/check 上已有写作违规，双方均按相同失败诊断计时；这些测量不声明历史仓库通过当前治理。trace show 对照使用 --fresh 当前语义。

异步热缓存连续七次测量：
- trace gaps: p50 362ms；样本 358, 351, 379, 362, 379, 390, 362ms；600ms预算通过。
- trace show docs/feature/local-sdlc/README.md: p50 377ms；样本 360, 360, 365, 377, 384, 385, 429ms；600ms预算通过。
- review render: p50 411ms；样本 360, 339, 411, 670, 412, 578, 374ms；600ms预算通过。

基线与候选原始独立进程样本（ms，保留到整数）：
- --help：baseline 273, 275, 274, 244, 300, 275, 270；candidate 276, 266, 267, 267, 239, 269, 277；cold 270 / 275。
- --skill：baseline 176, 178, 178, 182, 174, 175, 182；candidate 173, 176, 175, 180, 176, 180, 179；cold 176 / 179。
- memory index：baseline 539, 528, 521, 527, 533, 532, 537；candidate 484, 447, 502, 491, 508, 503, 510；cold 549 / 502。
- memory list：baseline 532, 478, 472, 476, 472, 463, 469；candidate 495, 465, 449, 444, 445, 439, 494；cold 553 / 502。
- memory recall HawDB：baseline 532, 495, 537, 534, 531, 542, 539；candidate 496, 478, 504, 511, 494, 509, 498；cold 530 / 469。
- memory search HawDB：baseline 541, 524, 531, 533, 547, 542, 542；candidate 498, 501, 516, 509, 504, 510, 503；cold 527 / 500。
- issue index：baseline 510, 522, 512, 519, 529, 520, 527；candidate 484, 489, 496, 491, 489, 492, 490；cold 521 / 495。
- issue list：baseline 518, 508, 469, 528, 519, 504, 534；candidate 489, 480, 445, 466, 479, 475, 489；cold 521 / 486。
- issue recall HawDB：baseline 519, 546, 513, 521, 532, 534, 520；candidate 493, 484, 497, 486, 495, 490, 490；cold 525 / 488。
- feature list：baseline 591, 600, 605, 612, 593, 603, 606；candidate 580, 577, 580, 583, 586, 591, 578；cold 617 / 585。
- docs check：baseline 885, 778, 862, 898, 870, 875, 888；candidate 855, 823, 852, 862, 867, 872, 874；cold 889 / 884。
- trace show docs/feature/local-sdlc/README.md：baseline 690, 701, 679, 698, 685, 682, 692；candidate 695, 690, 669, 607, 676, 692, 660；cold 1941 / 1921。
- trace check：baseline 680, 677, 680, 662, 700, 671, 669；candidate 683, 654, 645, 674, 647, 653, 667；cold 1906 / 1883。
- check：baseline 881, 1014, 1025, 1009, 1048, 1028, 1005；candidate 930, 980, 904, 1020, 995, 993, 913；cold 2283 / 2243。

## 实测修正

后台 --fresh 扫描原先持续持有服务历史结果的 HawDB，连续查询遇到 HawdbBusy。后台计算现使用 --dry-run 禁止持久解析句柄，只在结果提交时打开数据库。等待同键刷新所有权时不轮询数据库。引擎 checkpoint 窗口可能使预检观察到文件消失；前台完整安全检查最多重试500ms，后台提交最多重试3秒，不删除或绕过原生所有权。数据库持续占用时具名返回不可用，不冒充冷缓存。

## 验收

七项针对性测试通过：满额缓存失败保留结果、旧扫描不得吞掉新请求、目录大小变化、无共享租约读取、竞争写入拒绝、持有写所有权时ABA、真实CLI退出后刷新与当前门禁。

最终 `nix shell nixpkgs#gcc --command pnpm check` 通过：321 tests，319 pass，0 fail，2 skipped。两项跳过是生产原生构建未启用 test-hooks 的注入回滚与提交前 SIGKILL 测试，不声称覆盖这些注入场景。此前一轮浏览器导航断言出现时序失败，单独复测4/4通过，最终完整重跑也通过；未修改该UI用例。`concord docs check`、`concord check`、Design check 与 git diff --check 均通过。

## 发布资产验收

发布提交 `30f728d59b107be2997e180200f76c6c669249f1`，标签 `v0.8.5`；发布流水线 https://github.com/CorrectRoadH/Concord/actions/runs/36388016566 全部成功，包含 Linux x64 与 macOS arm64 原生产物。实际下载 tarball 与 SHA256SUMS、GitHub asset digest 一致：`133ebbcd6568e6a09c1ff360f752e5ef1a4a018b10574f464381b13121193154`。

隔离 npm 安装使用 --ignore-scripts，CLI 报 concord v0.8.5。verify-installed-native.ts 在 PATH 不含 Rust 编译器或数据库辅助程序时通过 Linux 原生缓存命中、当前 Memory recall、清理重建与安装身份校验。实际发布 CLI 通过冷缓存 QueryPending、独立进程刷新、历史结果、文档写入、--fresh 与 check 拒绝无效当前来源。该记录不声称 macOS 运行时或 Homebrew/Nix 安装验证。

同一冻结参照消费者上的已发布安装包连续七次缓存测量：
- trace gaps：p50 382ms；样本 370, 378, 382, 401, 398, 393, 377ms；600ms预算与波动判据通过。
- trace show docs/feature/local-sdlc/README.md：p50 399ms；样本 392, 396, 399, 408, 730, 512, 394ms；600ms预算与波动判据通过。
- review render：p50 406ms；样本 406, 610, 411, 393, 398, 568, 386ms；600ms预算与波动判据通过。

渠道自动通知因未配置 HOMEBREW_TAP_WORKFLOW_TOKEN 跳过，随后用已有用户授权触发同步工作流 https://github.com/CorrectRoadH/homebrew-tap/actions/runs/36388343710 ，成功回执 https://github.com/CorrectRoadH/homebrew-tap/releases/tag/v0.8.5 确认 Homebrew/Linux Nix 元数据映射0.8.5及相同包摘要；同步流程自身不执行安装或测试。
