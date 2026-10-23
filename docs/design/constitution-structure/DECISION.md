# 宪法的结构、关联与写法

## Decision

Undecided.

作者推荐 link-owned，等待独立审查。

## Rationale

两案共用 ID 语法、条款写法与宪法格式迁移，G1、G2、G4、G5 相同。差别在 G3：link-owned 让链接成为依据关系的唯一来源；metadata-owned 让同一关系在元数据与正文中各有一种写法。

G4: 条款写法依靠审阅执行。接受这个缺口：写作政策按目录生效，禁用实现词会误伤 architecture 页；为单个文件设政策需要改变写作政策的作用域模型，另案处理。

## Rejected Options

metadata-owned：G3 不满足，依据关系保留两种写法。

## Residual Risks

- 取消 `constitutionRefs` 与 `--constitution-ref` 会破坏依赖它们的脚本与接入项目，需要迁移命令与具名诊断。
- 迁移生成的数字款 ID 可读性差，语义名称依赖作者逐步改写。
