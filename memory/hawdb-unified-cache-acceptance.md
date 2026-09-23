---
format: concord.document/v1
id: hawdb-unified-cache-acceptance
title: HawDB 统一缓存验收
createdAt: 2026-09-23T05:16:58.431Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# HawDB 统一缓存验收

2026-09-23：Concord 已采用 `docs/design/hawdb-data-engine/README.md` 的 native-embedded 方案，并实现 `docs/feature/local-data-engine/README.md`。固定 HawDB revision 为 1e9f76428be6649a18a6f99d75b0ccfef16bf545，Rust 工具链为 1.97.1；设计经 Herdr 独立 Astra 挑战，执行由两个 GPT-6 Sol worker 分别完成桥接和缓存适配。

持久注解、代码、配置及反馈缓存使用 Git-private cache.hawdb；文档、代码与 Git baseline 的短期缓存使用真实内存 HawDB。无 node:sqlite/DatabaseSync 运行时导入。文件 owner、证据和发布 journal 保持原位置与权限语义；Memory/Issue 检索核对当前来源，未启用 BM25。

原生专用测试构建 9/9 通过，包括真实事务中途失败回滚、提交前 SIGKILL、双向跨进程排他、只读 existing-only、损坏 manifest 和预算。普通发布构建不含测试钩子，对应两个用例跳过。父验收修正了关闭原生数据库失败仍须释放 repository lease，以及取得清理锁后重新检查删除范围。CI 单独执行测试钩子构建，随后生成无钩子产物。

在 /home/ctrdh/.herdr/worktrees/NiceEval/repot-tool 用 --ignore-scripts 安装后的实际包验收。最终包 cold check 约 4.08 秒，warm check 约 2.40 秒，613 个代码条目全部命中；105 条既有旧注释格式 findings 与迁移前逐项相同，工作区无源文件改动。并行测试负载下计时不作为引擎优劣基准。安装包在 PATH 只有 Node/Git 时保持真实跨进程缓存命中，Memory 修改后的检索与清缓存重建通过，无 Rust 或 HawDB helper。Web 写作页面、连续 workspace 读取、缓存状态与空闲 Web 同时运行 CLI 通过。

生产桥接短期缓存微测：1000 条约 3.8 KB payload，冷填充约 286 ms、热读约 74 ms，热读无重复解析。该结果不是对旧 Map 的性能改进声明。相比 Map，统一引擎增加序列化与查询成本。

当前本机产物依赖 Nix，artifact.portable=false。发布流水线要求 Ubuntu 24.04 linux-x64-glibc 与 macOS 14 darwin-arm64 两个匹配产物，并以同一 tgz 在目标系统验收；本轮没有执行远端 CI、macOS 构建、发布或 push，不宣称跨平台发行已验收。

证据目录：/tmp/concord-hawdb-accept._k2xvxq3/final；原生测试日志：/tmp/concord-hawdb-hooks-final.log；全量检查日志：/tmp/concord-hawdb-full-check-final.log。探针与生产包验证分别保留，不把原型探针视为最终实现验收。

最终 `nix shell nixpkgs#gcc nixpkgs#pkg-config -c pnpm check` exit 0：257 项，255 通过、0 失败、2 个仅测试钩子用例跳过；专用原生测试构建 9/9 通过。额外 Web TypeScript 编译、workflow YAML 解析、git diff --check、Concord check 与 design check 通过。首轮完整检查发现重复契约测试标记及并发负载下浏览器刷新工作区的等待时序问题；分别修正标记与等待 workspace 响应完成后断言，最终完整复验通过。两个执行 worker 与挑战/探针的本轮 pane/tab 均已关闭，验收服务与浏览器已退出，无本轮遗留 worktree。未 stage、commit、push 或发布。
