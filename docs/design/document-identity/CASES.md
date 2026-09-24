# 共同验收场景

| Case ID | User Problem | Fixed Input | Acceptance Result |
| --- | --- | --- | --- |
| C1 | 中文文件被当作错误位置 | 英文内部 ID 与中文实际名称 | 两入口查询、编辑和关系均定位原文件 |
| C2 | 归档被当成现行契约 | Memory 来源中的历史 Design 及附页 | 原文只读展示，现行断链仍拒绝 |
| C3 | ID 解析后发生移动 | 冻结前像后移动或替换 owner | 写入冲突，恢复只使用记录路径 |
