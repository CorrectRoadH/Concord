# 命令

以下均为预期输出。

## 查看品味

```sh
concord taste
```

```text
T-1 读得懂胜过写得全
  docs/feature/cart/README.md:12
B-1 凭据不进入日志
  (没有页面依据这一条)
```

```sh
concord --json taste
```

```json
{
  "operation": "taste",
  "path": "docs/taste.md",
  "entries": [
    {"id": "t-1", "kind": "taste", "title": "读得懂胜过写得全", "paragraphs": []},
    {"id": "b-1", "kind": "floor", "title": "凭据不进入日志", "paragraphs": ["b-1-1"]}
  ],
  "references": [{"path": "docs/feature/cart/README.md", "line": 12, "entry": "t-1", "paragraph": null}],
  "complete": true
}
```

`entries` 按正文顺序列出，总则的 `kind` 为 `general`。`references` 每次出现一项，按 `path` 与 `line` 排序；指向条目而非款时 `paragraph` 为 `null`。任何纳入范围的文件无法读取时 `complete` 为 false。`concord taste` 只读，不写文件。

## 错误与 finding

| 代码 | 由谁报告 | 什么时候出现 |
| --- | --- | --- |
| `AnchorNotFound` | `check` | Spec 页面或 Issue 链接了不存在的条目或款 |
| `TasteLinkInvalid` | `check`、`taste` | 品味链接带 query，或百分号编码无法解码 |
| `TasteEntryInvalid` | `check`、`taste` | 条目或款缺少 ID、ID 格式不对、重复，或标签与 ID 不一致；消息带行号 |
| `TasteChangeUnrecorded` | `check --since` | 条目或款改变了，本次变化中却没有 Decision Memory 以 `changes` 指向它 |
| `TasteMissing` | `doctor`、`check` 的 advisories | 项目没有 `docs/taste.md`；不使 `check` 失败 |

finding 的类别为 `relation`，带路径与行号。
