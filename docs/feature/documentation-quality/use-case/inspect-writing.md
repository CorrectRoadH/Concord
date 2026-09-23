---
format: concord.document/v1
id: inspect-writing
title: 检查文档写作与术语一致性
createdAt: 2026-09-23T01:43:02.525Z
kind: use-case
feature: docs/feature/documentation-quality/README.md
---

# 检查文档写作与术语一致性

## 主流程

1. 维护者在目录所属 JSON 定义概念与写作政策，选择禁用表达、替换理由，以及所需的长度、概念和 SVG 检查。
2. 运行 `concord docs check --json`，或通过 `--rules` 选择另一份规则。Concord 严格解码规则，在同一仓库读取快照内扫描文件。
3. 作者按诊断逐处修改正文，再运行同一命令。CLI 不自动替换上下文用词，不保存第二份命中清单。

## 验收

- 打包安装后的公开 CLI 可在隔离 Git 消费者中运行，既不加载 NiceEval checkout，也不加载产品 runner。
- 同一文件命中重叠根时只检查一次。缺失规则、空扫描根与错误规则均返回具名错误，不能静默通过。
- 禁词按字面量匹配，ASCII 忽略大小写并限制词边界；中文按子串匹配。`allowIn` 只豁免包含该词的更长写法。路径范围按完整目录边界判断。
- Markdown 的 frontmatter、代码块、行内代码、链接地址和 HTML 注释不参与禁词检查。链接文字与图片替代文字参与；行内代码参与长度计算。MDX 组件标签、属性、单行 import/export 与显式生成区块不参与正文检查，容器中的 Markdown 仍检查。
- 长度忽略空白，软换行不能规避句段上限。标题、表格不计句段长度。分号与破折号不拆句。诊断至少定位到对应正文块的起始行。
- 领域定义只读 scoped concepts.json；每个语言的 deprecated 派生禁词，preferred/aliases 才算合法使用。按 canonical 概念与有效范围统计，不用兄弟同名概念或定义自身证明使用；引用和汇总均派生。
- SVG 的 text、title、desc 检查禁词，tspan 合并；label 类中的中文词需要正文或概念来源。显式选择的共用 CSS 与每张 SVG 的 style 正文比较。
- 路径逃逸与 symlink 拒绝。规则、正文、配置在读取过程中发生变化时，遵守现有仓库快照的一致性错误；不发布部分检查结果。
- 发现问题返回完整 findings 和非零退出码；清零后通过。静态写作检查不能变成测试覆盖率或实现合规证明。

扫描集合、祖先合成、显式 --rules 模式、冲突去重、局部 SVG 语料和输入摘要采用[目录方案](../../../design/scoped-terminology/plans/directory-owned/README.md)。旧 writing/v1 返回迁移诊断。
