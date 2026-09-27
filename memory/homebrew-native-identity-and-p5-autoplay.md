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

首次 v0.8.1 候选发布运行 36319827381 被门禁阻止：macOS Homebrew 实际安装后仍发生摘要变化，证明 preserve_rpath 单独不足以保证字节不变；没有创建正式 Release。另有一个 Linux 浏览器轮询时序用例超时。后续 Formula 在 install 将两个平台的 hawdb.node 暂存为 gzip，Homebrew 完成链接处理后在 post_install 解压恢复，继续以原始 artifact.json 摘要验证，绝不重新计算摘要来接受修改过的文件。失败候选标签更新前核对正式 Release 不存在。

用户进一步要求默认推荐流程动作循环：自动推进阶段、展示传递、停留、回到起点，不额外设计播放或步进控制器。使用契约与随包 view 指引已添加建议和可编译的 TypeScript 示例；交互式模拟仍可拥有必要控件。p5 编译产物尚未缓存，自动启动不会强行覆盖作者 noLoop 或自动点击内部按钮。新增建议不宣称已修改消费者自己的图解源码。

本地第二次隔离全量的 writing 与 view 浏览器时序失败分别定向复测通过（1/1、4/4）；Concord 自身 check 完整且零 findings，skill validator 通过，skill/release-workflow 定向测试 4/4，两个流程示例经实际 compileP5 类型检查与编译通过。
