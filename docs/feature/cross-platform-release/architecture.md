# 跨平台标签发布

## 实体所有权

源码标签与包元数据由 CorrectRoadH/Concord 拥有，其 GitHub Release 拥有 tgz。CorrectRoadH/homebrew-tap 拥有 Formula、Nix 表达式与 recipe 标签。

运行时协调遵循[可移植发布协调](../../design/portable-publication/README.md)：短快照与提交使用同一 Node 文件租约。HawDB 是可丢弃缓存。不支持不同锁协议的程序同时协调。

## 数据流

标签工作流在 CI 中从校验后的标签派生包元数据，合入 Linux x64 与 macOS arm64 原生产物并只打包一次，核验版本、原生产物身份与摘要，然后发布源码 Release。

tap 定期或经通知发现更新的公开发布，核验标签、包与资产身份，准备 Formula 与 Nix。候选 Formula 与 Nix 必须分别完成安装和运行检查；通过后才提交并打 recipe 标签，创建同版本渠道完成记录。日常发现、验证与更新不依赖 LLM。

## 不变量

- 普通运行时不探测文件系统名称，不调用外部锁或磁盘工具；支持的协调限于同一主机与 PID 命名空间。
- Darwin 保留路径段的精确拼写，别名不能产生第二个 owner 身份。
- 只有 ESRCH 证明所拥有的 POSIX 进程组已结束。清理不确定时不能产生 green 证据。
- 发布与渠道同步共享精确的候选 tgz 和 SHA-256；自动化成功不表示已完成安装或运行时验收。
- 版本不回退，已有身份不能被不同字节覆盖。

## 错误

不支持的主机、不可用的文件系统原语、不安全的别名与清理不确定都是具名运行时失败。源码发布失败归源码工作流，Formula 与 Nix 失败归 tap 同步。任何失败都不转换为发布成功的声明。

## 身份与复用

版本、源码标签 commit、包元数据、tgz SHA-256 与 recipe commit 构成发布映射。只有这些身份完全一致时，重跑才能继续中断的阶段。

原生引擎在各自目标系统上先于打包构建。打包任务先清理 dist，再收集完整且经核验的原生产物集合，只打包一次。后续验证解压该产物，不重新构建，也不删除其它目标。手动可移植检查必须断言真实的 HawDB 缓存未命中后命中，只回源不算通过。

## pnpm 包与渠道契约

Concord 的开发、测试、打包与渠道安装统一使用 pnpm。`package.json` 的 `packageManager` 固定开发与打包所用版本；`pnpm-lock.yaml` 是唯一依赖锁，`pnpm-workspace.yaml` 独占 overrides 与安装策略。发布包携带这三个文件，不携带另一种包管理器的锁。

打包使用 `pnpm --config.ignore-scripts=true pack --skip-manifest-obfuscation`，保留包管理器声明，不运行构建或安装脚本。

共享 TypeScript 打包入口将 pnpm 生成的归档解包到临时目录，补入源 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`，再生成最终 tgz。workspace 同时列入 package.json 的 files 白名单。入口核对 manifest、锁和 workspace 配置的原始字节，并清理临时目录。测试与发布必须调用同一入口，摘要只针对最终 tgz。

发布版本只从规范标签写入 `package.json.version`。pnpm 锁的根 importer 不保存项目版本；发布准备核对根 importer 的依赖 specifier、开发依赖 specifier 及 overrides 与源声明一致，不伪造锁中的项目版本。Repository 实现身份包含实际安装的 JavaScript、包元数据、原始 pnpm 锁与 workspace 配置。渠道不得修改这些身份输入，也不读取另一种锁格式作为回退。

隔离消费者测试通过共享测试入口调用 pnpm 打包和添加本地产物，严格解码 pnpm 的单对象 JSON 回执。消费者需要 TypeScript 或 runner 时自行声明固定版本，不依赖依赖提升。隔离测试从源 workspace 配置采用同一预发布依赖约束，禁止解析到不匹配的稳定版本。包身份测试核对分发锁和配置与源文件字节一致；渠道安装另外验证从解包根目录执行 `pnpm install --prod --frozen-lockfile --ignore-scripts`，不能用 `pnpm add` 的成功替代冻结安装。

Homebrew Formula 声明 `pnpm` 构建依赖，使用其受管理的可执行文件，遵循包内 packageManager 选择固定版本；干净的 Homebrew CI 必须验证冻结安装。Homebrew 将解包内容安装到 `libexec`，在该目录使用冻结锁和 `--package-import-method=copy` 安装生产依赖。外部 launcher 使用 Homebrew Node 运行 `libexec/dist/entry.js`。Formula 保留 `preserve_rpath`，在 Homebrew 重定位前压缩 `dist/native/*/hawdb.node`，在 post-install 恢复原始字节；安装不需要 Rust，不编译原生引擎。

Linux Nix 使用固定 nixpkgs 中的 `pnpm_11`、`fetchPnpmDeps` 与 `pnpmConfigHook`。其精确工具版本由 flake.lock 固定，不自动下载 packageManager 声明的工具；冻结安装验证该工具与发布锁的适配。依赖 fetcher 使用 `fetcherVersion = 4`、生产依赖和禁用脚本配置，包与 fetcher 使用同一源码、sourceRoot 和安装参数。固定输出 hash 来自候选包的真实 pnpm 依赖 store，不能沿用其它包管理器的依赖 hash。

安装阶段复制已完成离线冻结安装的包和 node_modules，launcher 调用 Nix Node；禁止修改 Concord JavaScript shebang、剥离原生引擎或改写发布锁。只支持 `x86_64-linux`，不把没有发行原生引擎的架构列为可安装目标。

tap 的同步入口使用受版本管理的 Formula/Nix 模板生成候选，模板与当前发行 recipe 分开。候选生成先核验标签、资产 SHA-256、manifest 版本和 pnpm 锁，再取得真实依赖 hash，验证冻结安装所需输入及原生产物元数据。hash 探测只接受目标 pnpm 依赖派生的单个固定输出不匹配结果；取得 hash 后必须重新构建同一个依赖派生成功，不能把任意 Nix 失败当作 hash。完整应用安装与运行测试由依赖候选产物的 Homebrew 与 Nix CI job 验证；最终更新 job 同时依赖两者成功，元数据核验不能替代安装成功。

渠道准备不改写当前可安装版本。源码发布 job 必须依赖对同一标签 commit 的检查成功，检查失败禁止创建源码 Release。源码发布前先更新两个仓库的工具与模板并通过相关 CI；新资产存在后同步候选，沿用 base SHA 与已有标签比较，原子更新 recipe 与渠道标签。源码 Release 和渠道完成回执分别核验。失败保留当前 recipe 和不可变资产，不覆盖既有发布，不通过降级锁校验使同步成功。
