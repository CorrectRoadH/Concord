# 命令

以下均为预期输出。

## 查看品味

```sh
concord taste
```

```text
T-1 读得懂胜过写得全
  docs/feature/cart/README.md:12
```

```sh
concord --json taste
```

```json
{
  "operation": "taste",
  "path": "docs/taste.md",
  "entries": [
    {"id": "t-1", "title": "读得懂胜过写得全"}
  ],
  "references": [{"path": "docs/feature/cart/README.md", "line": 12, "entry": "t-1"}],
  "complete": true
}
```

`entries` 按正文顺序列出，包含各条目与总则（总则 `id` 为 `general`）。`references` 每次出现一项，按 `path` 与 `line` 排序。任何纳入范围的文件无法读取时 `complete` 为 false。`concord taste` 只读，不写文件。

## 错误与 finding

| 代码 | 由谁报告 | 什么时候出现 |
| --- | --- | --- |
| `AnchorNotFound` | `check` | Spec 页面或 Issue 链接了不存在的条目 |
| `TasteLinkInvalid` | `check`、`taste` | 依据的链接带 query，或百分号编码无法解码 |
| `TasteEntryInvalid` | `check`、`taste` | 条目缺少 ID、ID 格式不对、重复，或标签与 ID 不一致；消息带行号 |
| `TasteMissing` | `doctor`、`check` 的 advisories | 项目没有 `docs/taste.md`；不使 `check` 失败 |

finding 的类别为 `relation`，带路径与行号。
