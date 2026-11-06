# 库接口

PR 预览的消费者在发布前用[库包](../local-sdlc/library.md) `concord-sdlc` 中的解码器核对 `changes.json`，浏览器阅读器使用同一个解码器。字段见 [PR 预览产物格式](format.md#changesjson)。

```ts
import { decodeChangePreview } from 'concord-sdlc/change-preview';

const preview = decodeChangePreview(JSON.parse(text));
console.log(preview.comparison.base, preview.comparison.head, preview.comparison.baseLabel);
```

| 导出 | 签名与返回值 |
| --- | --- |
| `ChangePreviewSchema` | `concord.change-preview/v1` 的严格 Schema |
| `ChangePreviewEntrySchema` | 单个条目的严格 Schema |
| `decodeChangePreview(input: unknown): ChangePreview` | 严格解码并返回预览数据；未知字段、未知版本或违反约束时抛出解码失败，失败带字段路径 |
| `ChangePreview`、`ChangePreviewEntry`、`PreviewSide` | 解码结果的类型 |
| `PREVIEW_ENTRY_LIMIT` | 条目数上限，2000 |
| `PREVIEW_DATA_LIMIT` | `changes.json` 的字节上限，8 MiB |

消费者核对时还需独立计算 merge-base，与 `comparison.mergeBase` 比对，见[在 PR 预览中审阅变更](use-case/review-pull-request.md#消费者接入)。
