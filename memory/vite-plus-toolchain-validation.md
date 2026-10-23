---
format: concord.document/v1
id: vite-plus-toolchain-validation
title: Vite+ 任务入口与脚本职责验收
createdAt: 2026-10-23T06:28:51.409Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Vite+ 任务入口与脚本职责验收

2026-10-23，按用户要求采用项目固定的 Vite+ 1.3.0，仍由 pnpm 11.18.0 管理依赖。Vite 使用 @voidzero-dev/vite-plus-core 别名；不采用迁移器自动生成的 catalog，避免 pnpm pack 改写 manifest 破坏发行身份。独立消费者与 adapter 的 Vitest 4.1.11 契约保留，不把 fixture 改成依赖 Vite+。安装仍报告 Vite 别名版本及可选 browser-preview peer 提示；实际构建、消费者与 adapter 测试已执行。

`vp build` 通过生产构建钩子生成完整发行产物：原生绑定、CLI/repository 类型与 JS、Effect 导入收窄、Web、Preview、P5、许可证、host types 和可执行权限。必要的产物处理归 scripts/distribution.ts，移除独立 scripts/build.ts 入口与重复启动 Vite 的子进程。开发服务器不执行这些生产钩子。pack-release.ts 的三行入口合入 release-package.ts，导入模块时不执行打包。

快速入口 vp run check:fast 只做 CLI/Web 源码类型检查。vp run typecheck:built 检查当前构建上的 repository、测试和脚本；vp run test:built 支持文件、--test-name-pattern 和 --test-shard，保留一次打包、独立消费者、四文件并发与退出码/Scope 清理。CI 的四个串行分片共用此入口，每个分片只打包一次。vp run check 与 pnpm check 是完整门禁；Vite+ 内置 vp check/vp test 不执行本项目脚本。所有任务结果缓存关闭。

验证：vp install --frozen-lockfile、check:fast、完整 vp build 与所有类型检查通过。vp dev 实际启动并以 HTTP 返回工作台入口，随后终止。新的打包 CLI 返回实际归档；文件+名称+1/1分片选择测试1/1通过，未知选项返回具名失败。Concord docs check：371文件、无 findings。发布流程定向4/4通过。

最终完整命令：nix shell nixpkgs#gcc nixpkgs#pkg-config -c env CARGO_TARGET_DIR=/tmp/concord-vp-cargo vp run check。当前 shell 缺少 cc 且旧 Cargo 缓存程序无法启动，使用独立临时 Cargo 目录与 Nix 工具链恢复构建。测试阶段950349ms，496项，487通过、3失败、6既有跳过，退出1。日志 /tmp/concord-vp-check-final.log。未把本轮时间与先前不同环境测量作性能提升对比。

三个失败：发布流程断言仍匹配删除的 pack-release.ts 路径，已修正并4/4复测通过（/tmp/concord-vp-workflow-final.log）；selfhost要求release-from-tag用例具有实现关联，但sourceRoots只扫描src/web，当前HEAD中这些目录没有该关联，在HEAD源码归档上使用当前构建复现相同失败（/tmp/concord-vp-selfhost-baseline.log）；writing-cache暖读加载parser是既有问题，未改变断言或删除fixture。后两项不在本次工具链迁移范围内，不能声称完整绿色。此前旧构建入口的一轮检查为配合用户补充要求主动中止，退出130，不计入最终验收。

后续测试提速建议：按产品功能拆解大CLI测试文件，让文件并发更均衡；将真实120秒deadline验收与可控时钟下的状态转换测试区分，保留正式入口与进程清理覆盖。不能仅换runner、减少断言或用定向测试替代完整门禁。

保留原有 web/pages/git.tsx、web/pages/git/file-tree.tsx、web/styles.css 改动，不纳入本次提交。未创建pane/tab/worktree；开发服务器与测试运行已结束。
