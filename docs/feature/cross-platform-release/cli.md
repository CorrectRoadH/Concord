# 跨平台标签发版命令

## 命令

维护者在已推送的 commit 上创建并推送附注标签 `v<version>` 来发版，工作流以标签中的版本作为发版版本。工作流同样接受 `concord-v<version>`。无效标签，或已有身份不同的同名标签与 Release，都会被拒绝。

工作流在自己的 CI 机器中把版本写入应用的包元数据，安装后的 CLI 从包内元数据读取版本。手动触发且不带标签时只做校验，不发版。

```sh
git tag -a v0.9.0 -m 'Concord 0.9.0'
git push origin v0.9.0
```

## 发版资产 {#发布资产}

一个 GitHub Release 恰好附带以下资产。Concord 只通过归档分发：

| 资产 | 内容 |
| --- | --- |
| `concord-<version>-linux-x64.tar.gz` | x86_64 Linux（glibc 2.39 及以上）归档 |
| `concord-<version>-darwin-arm64.tar.gz` | Apple Silicon macOS 归档 |
| `SHA256SUMS` | 两个归档与 `install.sh` 的 SHA-256，每行 `<sha256>  <资产文件名>`，不含自身 |
| `install.sh` | [安装脚本](use-case/install-with-script.md) |

归档解压后的根目录：

| 路径 | 内容 |
| --- | --- |
| `bin/concord` | 固定 Bun 编译的单个可执行文件，内含应用与字节码；从真实文件位置定位归档 |
| `runtime/rg` | 固定版本的 ripgrep |
| `runtime/lib/` | 仅 Linux：归档内 ELF 需要的 glibc 之外的运行库（libatomic、libstdc++） |
| `licenses/` | Bun 及其嵌入组件、ripgrep、Linux 运行库与运行依赖的许可证文本 |
| `app/` | 外置工具（TypeScript、esbuild）、该目标的官方 HawDB 动态库及其清单与安装收据、随附资源（Web、Preview、skills、templates） |

tap 随后包含同版本的 Formula 与 Linux Nix 表达式，引用相同归档与 SHA-256。从任一渠道安装后，`concord --version` 输出标签中的版本。

## 错误

构建、归档身份、摘要、候选验证或渠道元数据生成失败，都会阻止对应的发版步骤。源码发版要求两个目标的候选验证与同一标签 commit 的检查都通过；渠道更新要求 Homebrew 与 Nix 候选的安装运行检查通过。重跑只能复用标签与字节完全相同的产物。
