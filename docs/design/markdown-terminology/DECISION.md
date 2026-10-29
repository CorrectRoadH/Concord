# 单一写法的术语由 Markdown 拥有

## Decision

Selected: [markdown-owned](plans/markdown-owned/README.md)

## Rationale

两案都让每个概念只有一个写法，G1、G3 相同。差别在 G2：markdown-owned 把定义与解释放进同一个 `concepts.md`，正文可以链接到 `concepts.md#id`，断开的链接由 `check` 报告；json-single-term 仍需要第二份解释页，定义也不能含链接。

markdown-owned 的代价是需要 Markdown 结构解析器和改为源码编辑的 Web 术语页。解析沿用宪法的 `{#id}` 标题语法与链接扫描规则，额外复杂度集中在 catalog 的结构校验上。文件名区分新旧格式，catalog 不设版本字段。

## Rejected Options

json-single-term 改动最小，但定义与解释继续分处两个文件，正文无法链接到定义，不满足 G2。

## Residual Risks

- 接入项目需要手动改写术语来源，并为每个概念选择唯一写法；Concord 不识别 `concepts.json`，未改写的项目会失去术语检查而不收到提示。
- 本设计未经独立审查，由项目维护者直接定案。
