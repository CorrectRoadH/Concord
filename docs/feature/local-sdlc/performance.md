# 本地 SDLC 的性能预算

本页声明 local-sdlc 高频命令的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)。

## 性能预算

高频只读命令与检查命令的当前来源模式在[性能测量](../../engineering/performance/README.md#测量方法)规定的方法下满足以下 warm p50 预算。

- 参照消费者：本仓库 commit `6346f4cf78bc3553448a0119443f8f2ec681f5d5` 的独立 clone，含 61 份文档 owner、6 条 Memory、232 个测试标记与 97 个代码声明。
- 参照环境：AMD Ryzen 7 5800X，Linux x64，Node v24.19.0。
- 阈值规则：每组阈值为参照实测 p50 加约 20% 余量取整，同组命令共用阈值；交付验收按完整采样实测确认。测量记录归 Memory。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `local-sdlc/help` | 由静态数据输出的 CLI 帮助 | 50ms |
| `local-sdlc/skill` | Agent 指引 | 350ms |
| `local-sdlc/memory-list`、`local-sdlc/memory-search` | Memory 列表与检索 | 550ms |
| `local-sdlc/issue-list`、`local-sdlc/issue-search` | Issue 列表与检索 | 500ms |
| `local-sdlc/feature-list`、`local-sdlc/use-case-list`、`local-sdlc/design-list`、`local-sdlc/roadmap-list`、`local-sdlc/engineering-list` | 文档类别列表 | 600ms |
| `local-sdlc/docs-check` | 写作检查 | 1000ms |
| `local-sdlc/trace-show-fresh`、`local-sdlc/trace-check` | 当前关系读取与检查 | 1300ms |
| `local-sdlc/check` | 合并检查 | 2300ms |
| `local-sdlc/trace-show-fresh-server`、`local-sdlc/trace-check-server` | 经由运行中的工作区服务读取与检查当前关系 | 1300ms |
| `local-sdlc/check-server` | 经由运行中的工作区服务的合并检查 | 2300ms |
| `local-sdlc/code-list` | 代码声明列表 | 2460ms |
| `local-sdlc/test-list` | 测试声明列表 | 1910ms |
| `local-sdlc/template-list` | 随包模板列表 | 430ms |
| `local-sdlc/schema` | 输出一个机器可读 Schema，不需要项目目录 | 430ms |

帮助预算按静态输出的实测确定（禁用编译缓存时 p50 约 47 ms）；代码、测试、模板与作者正文四行的参照消费者为本仓库 `d267e06` 的独立 clone。

异步投影的历史读取预算与后台刷新上限由[本地数据引擎的性能预算](../local-data-engine/performance.md)拥有，本表不重复声明。规模增长导致超出预算时，先按性能验收方法定位瓶颈，再调整实现或经修订调整预算，不跳过校验。`bun run bench local-sdlc` 通过场景 ID 读取本表测量，表格保持[预算表格式](../../engineering/performance/format.md#预算表)。
