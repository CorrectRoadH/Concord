---
format: concord.document/v1
id: plan-and-adopt-contracts
title: 规划并采用文档契约
createdAt: 2026-09-13T11:00:34.175Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 规划并采用文档契约

## 场景

作为功能负责人，我希望 Feature、Use Case、Roadmap、Design 与 Engineering 各自拥有清晰正文和 supporting pages，并能把已定稿 Roadmap 安全采用为当前 Feature。

## 主流程

1. Feature、Roadmap 和 Design 候选创建必需 README；作者用 --pages 选择 library、cli、architecture、lifecycle、use-case。Design 外层目标、限制、案例、裁决页始终生成。Engineering 从目标、机制、使用、验收开始，按需加专题页。
2. `page show` 返回正文与 digest；`page set` 只在 preimage 未变化时写入。
3. Design 只允许一次裁决；Roadmap adoption 复制实际 Markdown 集合、重写集合内安全链接并迁移当前 promotion。
4. 原 Roadmap 保留 adopted 历史，新 Feature 成为当前契约 owner。

## 验收

- 相同 kind 的重复 id、嵌套 owner、附件、symlink、目标冲突和不支持的链接均拒绝且不留下部分写入。
- supporting page 可被精确 path/anchor 解析到所属 Feature，但相邻 package 不混入。
- adoption 期间源集合或字节变化会阻止 publication。

文档 ID、Design 候选名称及自定义专题名支持 Unicode 字母、组合标记和数字，可用单连字符分隔。Use Case 文件名随 ID 原样生成，例如 `use-case/扩展NPC动作.md`；专题名 `认知与执行` 生成 `认知与执行.md`。现有英文名称和固定模板入口继续有效。CLI 与 Web 使用同一校验，创建、发现、按 ID 查询、按路径引用及摘要保护编辑都须支持这些名称。名称不自动翻译、变换大小写或规范化；不允许空白、控制字符、路径分隔符、点段或引用分隔符，既有路径、symlink、冲突和事务保护继续生效。
