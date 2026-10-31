---
status: open
---

# 实现品味功能，替换宪法

## 请求

维护者决定把宪法功能改为品味。内容重组已经完成：[宪法](../constitution.md)现在由 8 条品味与 6 条底线组成，机制条款已移入所属页面。名称与命令尚未改变。

## 目标行为

目标行为写在 [Roadmap：写下项目的品味](../roadmap/taste/README.md)，要点：

- 文件为 `docs/taste.md`，没有 frontmatter，也没有草稿与生效两种状态。
- 只有一个只读命令 `concord taste`，列出条目和依据它们的页面；取消 `adopt` 与 `amend`，修改就是直接编辑。
- 修改记录的关系角色由 `amends` 改为 `changes`。
- 条目 ID 为品味 `T-n` 与底线 `B-n`；错误码见 Roadmap 的命令页。

## 迁移本仓库

实现与迁移在同一变化中完成，然后用 `concord roadmap adopt taste` 把 Roadmap 移入 `docs/feature/`，替换 project-onboarding 的“功能开发遵守并修订项目宪法” Use Case。

- `docs/constitution.md` 改名为 `docs/taste.md`，去掉 frontmatter。
- C-017 至 C-024 改为 T-1 至 T-8。
- C-002、C-003、C-007、C-005、C-006、C-015 依次改为 B-1 至 B-6。
- Spec 页面与 Issue 的链接随之改写；Design 与 Research 是记录，保留原链接。
- 修改记录 Memory 的 `amends` 改为 `changes`，目标按上面的对照改写。
