---
format: concord.document/v1
id: query-current-projections
title: 检索当前来源的派生投影
createdAt: 2026-09-23T04:17:21.855Z
kind: use-case
feature: docs/feature/local-data-engine/README.md
---

# 检索当前来源的派生投影

Memory 和 Issue 的 index、recall 通过 Concord 工具读取。数据引擎保存可重建投影，来源文件拥有身份、正文、关联与生命周期。派生投影不能成为第二个登记表，不能绕过来源 Schema、路径、权限或当前摘要核验。

查询结果绑定当前来源代次，保留 canonical path 与摘要。新增、修改、删除、跨 Memory source 和局部 scope 变化后，结果不得混入上一代对象。空查询仍具名拒绝。若引擎不可用，基础本地读取继续提供明确的回源行为；无法保持语义的增强检索能力必须明确不可用，不能伪装为成功。

用户清空缓存后再次索引和检索得到当前来源的等价结果。索引重建不修改 owner，不触发远端同步、模型调用或 evidence 生成。
