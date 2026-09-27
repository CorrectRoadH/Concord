---
format: concord.document/v1
id: homebrew-native-identity-and-p5-autoplay
title: Homebrew 原生摘要与 p5 自动展示验收
createdAt: 2026-09-27T12:41:09.295Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Homebrew 原生产物摘要与 p5 自动展示

用户在 macOS Homebrew 0.8.0 安装观察到 workspace 连续请求耗时 13–14 秒，buildTrace 占 12–13 秒；缓存状态明确报告 native binary digest differs。下载官方 v0.8.0 tgz 核对，darwin-arm64/hawdb.node 的 SHA256 为 d99370cbd74fe687f00ff4e305655e2409ec022aaf3efebcc578f6c1694b0099，与现场 expected 一致，现场 actual 为 1aeb4ada697b0508f4f6e632aa5e334f1a55e959d0d65de113610dbbee5f94fa。

发布包 Mach-O LC_ID_DYLIB 保存了 /Users/runner/work/Concord/Concord/native/hawdb/target/release/deps/libconcord_hawdb_native.dylib。Homebrew 的 fix_dynamic_linkage 会改写 dylib ID 并重新签名；原有 npm 安装验收不覆盖这一渠道变换。源码依据：https://github.com/Homebrew/brew/blob/master/Library/Homebrew/extend/os/mac/keg_relocate.rb 。未取得用户安装后的完整二进制，不能声称逐字节对比了现场改写。

修复将 macOS 链接标识固定为 @rpath/hawdb.node，构建便携检查验证该标识，tap Formula 生成器采用 preserve_rpath。保留完整二进制摘要验证，不在安装后重写 artifact.json。发布门禁新增真实 macOS Homebrew 安装并执行 verify-installed-native，tap 候选安装矩阵覆盖 Linux 与 macOS，Formula test 要求第二次 test list 缓存 hit。cache clear 不能修复安装产物。

p5 阅读和编辑图块自动加载，编辑防抖 250ms，正常展示移除外层运行工具栏，失败保留重试。保持沙箱、视口暂停、noLoop 意图和离页释放；sketch 自身的 DOM 控件与时间推进逻辑仍由作者源码拥有。

44dce0f 的远端 Check 36319257190 完整 pnpm check 通过：295 tests，293 pass，0 fail，2 skip。打包浏览器专项验证自动启动、视口暂停与恢复、noLoop、刷新、扩展、安全隔离与离页清理。首轮本地全量包含既有 README 编辑引起的 quick-start 失败；隔离 checkout 消除该干扰后有一次无关文档导航超时，单项复测通过，远端全量也通过。没有修改原有 README 改动。macOS 渠道验收由发布工作流继续执行；未声称已复测用户 RPG 仓库的实际延迟。
