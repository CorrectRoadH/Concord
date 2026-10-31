# 命令

以下为预期输出。

## 安装与卸载

```sh
concord herdr install
concord herdr uninstall
```

`install` 把随包的 mod 写到 Herdr 的 mods 目录（`$HERDR_APP_HOME/mods/concord`，未设置时为 `~/.config/herdr-app/mods/concord`），已存在时覆盖为当前版本。`uninstall` 删除这个目录。`--json` 返回 `{"operation":"herdr-install","path":"..."}`。

| 错误 | 什么时候出现 |
| --- | --- |
| `HerdrNotFound` | 找不到 Herdr 的配置目录 |

## mod 调用的命令

mod 只通过公开 CLI 取数据和执行操作，不读取 Concord 的私有状态：

| 用途 | 命令 |
| --- | --- |
| 判断目录是否已初始化、初始化 | `concord --json doctor`、`concord --json init` |
| 文档列表 | `concord --json list` |
| 一页文档及其测试、实现与关系 | `concord --json show <path>` |
| 术语 | `concord --json concepts index` |
| 品味与依据位置 | `concord --json taste` |
| 检查 | `concord --json check` |

这些命令的输出见各自 Feature 的 cli 页，mod 不另定义字段。
