# 命令

以下为预期输出。

## 安装与卸载

```sh
concord herdr install
concord herdr uninstall
```

`install` 把随归档提供的 mod 写到 Herdr 的 mods 目录（`$HERDR_APP_HOME/mods/concord`，未设置时为 `~/.config/herdr-app/mods/concord`），已存在时覆盖为当前版本。从源码运行时，`install` 先把 mod 构建到同一个 mods 目录再安装，不需要事先构建归档，检出中也不留下产物。`uninstall` 删除这个目录。`--json` 返回 `{"operation":"herdr-install","path":"..."}`。

| 错误 | 什么时候出现 |
| --- | --- |
| `HerdrNotFound` | 没有 `herdr-app` 命令，也没有 Herdr 的配置目录；消息给出安装 Herdr 的命令 |
| `HerdrModPathOccupied` | `mods/concord/` 已存在且不是 Concord 的 mod |
| `HerdrModCheckFailed` | 安装后 `herdr-app check` 失败；`details.output` 是 Herdr 的输出 |

各情形的结果见[用 Concord 命令安装 mod](use-case/install-with-cli.md)。

## mod 调用的命令

mod 只通过公开 CLI 取数据和执行操作，不读取 Concord 的私有状态：

| 用途 | 命令 |
| --- | --- |
| 判断目录是否已初始化、初始化 | `concord --json doctor`、`concord --json init` |
| 文档列表 | `concord --json list` |
| 一页文档及其测试、实现与关系；文档包的全部页面（`pages`） | `concord --json show <path>` |
| 术语 | `concord --json concepts index` |
| 品味与依据位置 | `concord --json taste` |
| 检查 | `concord --json check` |

这些命令的输出见各自 Feature 的 cli 页，mod 不另定义字段。
