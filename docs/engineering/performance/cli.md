# 测量命令

测量与 profile 都在本仓库自举：被测产物是当前 worktree 的构建，默认消费者是当前仓库某个 commit 的独立 clone。入口先构建被测归档，结果以 JSON 输出到 stdout，可用 `--out` 另存。测量方法见[性能测量](README.md#测量方法)。

```text
bun run bench [<场景 ID | feature-id> ...] [--changed [<base>]] [--compare [<rev>]] [--quick] [--reference]
             [--consumer self|scale|<path>] [--commit <rev>] [--scale <sources>,<tests>,<pages>]
             [--samples 7] [--out <file.json>] [--keep]
bun run bench:profile <场景 ID> [--warm] [--out <dir>] [--keep]
bun run bench:profile cli [--consumer ...] [--warm] [--out <dir>] [--keep] -- <concord 参数>
```

| 选择与模式 | 行为 |
| --- | --- |
| 场景 ID 或 feature-id | 只运行指定场景，或该 Feature 的全部场景；都省略且未给 `--changed` 时运行全部场景 |
| `--changed [<base>]` | 选择受本次改动影响的场景，见下文 |
| `--compare [<rev>]` | 与基线产物交错对照，`<rev>` 默认同 `--changed` 的 base。基线自动准备 |
| `--quick` | 每组 3 次样本，只输出 p50 与预算的对照，用于开发中快速反馈；记录的 `acceptance` 恒为 false |
| `--reference` | 声明当前机器为参照环境，判定绝对预算 |
| `--samples <n>` | 每组样本数，默认 7；低于 7 的记录只用于定位，不作为预算验收证据 |
| `--keep` | 保留临时消费者与进程输出 |

`--changed` 的改动文件为 `<base>`（默认 `origin/master` 与 HEAD 的 merge-base）到 worktree 当前文件的全部差异，包括未提交改动。改动文件通过代码归属声明（`@concord-implements`）映射到 Feature，选中这些 Feature 的场景。改动了 `bench/<feature-id>.bench.ts` 的选中该文件的场景；改动了 `scripts/perf/` 或 `bench/fixtures/` 的选中全部场景。

省略 `--compare` 时只测候选产物，判定只包含样本有效性、刷新上限，以及声明 `--reference` 时的绝对预算。

`bench:profile <场景 ID>` 用 Bun CPU profiler 和 fs 调用计数执行该场景的一次 `run`，`bench:profile cli` 对任意一条命令做同样的 profile。Concord 启动的内部 Bun 进程同样产出 profile。profile 用于定位热点，wall time 含 profiler 开销，只用于 profile 之间比较，不作为预算或上限证据。profile 未指定 `--out` 时，在系统临时目录创建输出目录并保留。

## 常用组合

```sh
# 本仓库 HEAD 的 clone 上测量 local-sdlc 的预算，与 merge-base 基线交错对照
bun run bench local-sdlc --compare

# 大仓库规模下的刷新扫描是否在后台刷新上限内，以及缓存读取预算
bun run bench local-data-engine --consumer scale

# 复现某个外部仓库的刷新超时：先克隆成干净副本再原地测量
git clone ~/Downloads/rpg-game /tmp/rpg-game-frozen
bun run bench local-data-engine --consumer /tmp/rpg-game-frozen --samples 3

# 定位刷新扫描耗时：CPU 热点、system 时间与 fs 调用次数
bun run bench:profile local-data-engine/trace-gaps-refresh --consumer scale
bun run bench:profile cli --consumer self --warm -- check

# 只测本次改动影响的 Feature，交付前与基线对照
bun run bench --changed --compare
```

## 消费者

| `--consumer` | 来源 | 用途 |
| --- | --- | --- |
| `self`（默认） | 本仓库 `--commit`（默认 `HEAD`）的独立 clone；未提交改动不进入消费者 | 自举预算与回退对照 |
| `scale` | 候选产物通过公开 CLI 初始化的合成仓库，按 `--scale` 生成源码、测试与附页后提交冻结 | 大仓库规模与刷新上限 |
| 路径 | 已有的干净 Git consumer，原地测量 | 复现外部仓库问题 |

`scale` 默认 3600 个源码文件、600 个测试文件、1000 个附页，对应已接入的大型游戏仓库规模。源码文件带 `@concord-file` 与 `@concord-implements`，测试文件带 `@use-case`，附页链接到所属 Feature，使扫描覆盖文档、测试与代码归属三类来源。

`self` 与 `scale` 消费者准备完成后执行一次 `concord cache rebuild`，并以 `cache status` 确认为 `ready`，记录中 `consumer.cache` 为 `ready`；否则测量失败，因为没有有效缓存时 warm 样本实际是 cold。

原地测量的路径消费者必须没有未提交改动；测量只改动可丢弃的 HawDB 缓存，`cold` 场景会清空该缓存。

## 测量记录

`concord.bench/v2` 记录一次测量的全部判定，每条判定对应一个场景，用两个字段区分诊断结论与验收结论：

- `pass`：没有任何判定失败。为 false 时进程退出码为 1。
- `acceptance`：可作为预算验收证据。仅当 `pass` 为 true、每组至少 7 次样本、全部样本组有效，未使用 `--quick`，且声明了 `--reference` 或使用了 `--compare` 时为 true；否则为 false，并在 `acceptanceGaps` 列出缺少的条件。

`acceptanceGaps` 按条件依次包含 `failed verdicts`、`samples < 7`、`invalid sample groups`、`quick mode`、`no baseline and not reference`。未命中任何条件时不输出该字段。交付验收引用 `acceptance` 为 true 的记录；`pass` 为 true 而 `acceptance` 为 false 的记录只用于定位。

```json
{
  "format": "concord.bench/v2",
  "selection": { "changed": "origin/master...worktree", "scenarios": ["local-data-engine/trace-gaps-refresh"] },
  "environment": { "node": "v24.19.0", "platform": "darwin", "arch": "arm64", "cpu": "Apple M4", "cpuCount": 10, "memoryBytes": 34359738368 },
  "reference": false,
  "samples": 3,
  "consumer": { "kind": "scale", "cache": "ready", "commit": "4f0c…", "scale": { "sources": 3600, "tests": 600, "pages": 1000 } },
  "artifacts": [{ "label": "candidate", "commit": "2241a72…", "dirty": false, "digest": "sha256:…" }],
  "verdicts": [{
    "scenario": "local-data-engine/trace-gaps-refresh",
    "budget": { "owner": "docs/feature/local-data-engine/performance.md", "heading": "刷新上限" },
    "limitMs": 120000, "limitKind": "max", "withinLimit": false,
    "candidate": { "samples": [178000, 176500, 177000], "p50": 177000, "max": 178000, "valid": true },
    "pass": false, "reasons": ["max 178000ms exceeds 120000ms"]
  }],
  "snapshots": [{ "scenario": "local-data-engine/trace-gaps-warm", "artifact": "candidate", "lastError": "{\"ok\":false,\"error\":\"QueryPending\",…}" }],
  "pass": false,
  "acceptance": false,
  "acceptanceGaps": ["failed verdicts", "samples < 7", "quick mode", "no baseline and not reference"]
}
```

`concord.profile/v2` 标明场景 ID 或命令，按进程列出 CPU 自身耗时最高的函数、按层（安装目录内模块、依赖包、`node:internal`、原生）汇总的耗时，以及 user/system CPU、最大 RSS 和各 `node:fs` 调用的次数与同步耗时。原始 `.cpuprofile` 留在输出目录，可用 Chrome DevTools 或 speedscope 打开。

```json
{
  "format": "concord.profile/v2",
  "scenario": "local-data-engine/trace-gaps-refresh",
  "command": ["concord", "--json", "--fresh", "--dry-run", "trace", "gaps"],
  "wallMs": 181204,
  "processes": [{
    "pid": 41872,
    "resources": { "userMs": 82470, "systemMs": 100380, "fs": { "lstatSync": { "count": 1843210, "ms": 61210 } } },
    "layers": [{ "name": "node:internal", "selfMs": 64012, "share": 0.36 }],
    "functions": [{ "name": "lstatSync node:internal:1520", "selfMs": 58120, "share": 0.33 }]
  }]
}
```

示例中的数字只说明字段形状，不是测量结论。
