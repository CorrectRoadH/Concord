# PR 预览产物格式

`concord view export` 输出的目录是消费者托管、审阅者打开的静态产物。调用与错误见 [PR 静态预览导出](cli.md#pr-静态预览导出)，解码器见[库接口](library.md)，用户路径见[在 PR 预览中审阅变更](use-case/review-pull-request.md)。

## 输出目录

输出固定为 `index.html`、`changes.json` 与 `assets/`，资源从随包静态目录派生，不含 symlink。链接相对输出目录，页面可部署在子路径。

页面地址的 hash query 拥有：

| 参数 | 取值 |
| --- | --- |
| `path` | 选中的条目路径 |
| `view` | `unified` 或 `split` |
| `content` | `diff`、`before` 或 `after` |

输出不含凭据、未提交文件或 Git metadata。

## changes.json

`changes.json` 的格式为 `concord.change-preview/v1`。解码拒绝未知字段与版本。

| 字段 | 语义与约束 |
| --- | --- |
| format | 字面量 `concord.change-preview/v1` |
| comparison | base、head、mergeBase 为同一对象格式的 40 或 64 位小写十六进制 ID；baseLabel 为非空纯文本，最多 256 字符，只作展示，默认等于输入的 base |
| entries | 最多 2000 项；path 唯一，取 head 路径，删除时取旧路径；UTF-8 仓库相对路径，无 NUL、空段、`.` 或 `..` |
| entry.status | A、D、M、R、T；R 必须有与 path 不同的 previousPath，其余不得有 |
| entry.before / after | null 表示该侧不存在，否则为 `{oid, mode}`；mode 为字符串 100644、100755、120000 或 160000；before 取 mergeBase 的 previousPath 或 path，after 取 head 的 path；A 的 before、D 的 after 必须为 null，其余两侧都存在，oid 长度与 comparison 一致 |
| entry.patch / binary | patch 为统一差异文本；二进制、纯模式变化与内容不变的 rename 的 patch 可为空字符串，界面仍显示状态与两侧对象 |
| entry.beforeMarkdown / afterMarkdown | 仅当对应侧为普通文件模式、后缀 `.md`/`.markdown` 且非二进制时存在；空字符串是空正文，缺失表示不适用 |

gitlink 只显示 commit ID，symlink 只显示 blob，不跟随。非 UTF-8 或含 NUL 的正文按二进制处理。
