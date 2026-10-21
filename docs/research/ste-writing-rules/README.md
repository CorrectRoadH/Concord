---
format: concord.document/v1
id: ste-writing-rules
title: ASD-STE100 规则类别与使用边界
createdAt: 2026-10-21T07:38:10.055Z
kind: research
observedAt: 2026-10-21
sources:
  - https://www.asd-europe.org/news-media/news-events/news/simplified-technical-english-asd-ste100-issue-9/
  - https://asd-ste100.org/
  - https://www.asd-ste100.org/software.html
---

# ASD-STE100 规则类别与使用边界

## 规范事实与证据等级

ASD Simplified Technical English Maintenance Group（STEMG）负责维护 ASD-STE100。官方主页的检索内容列出 Issue 9，日期为 2025-01-15；[Terms of Reference](https://www.asd-ste100.org/STEMG_ToR.html) 的检索内容说明该组的维护职责。[官方主页](https://asd-ste100.org/)

官方 [Tools for STE](https://asd-ste100.org/STEsoftware.html) 的检索内容说明：ASD/STEMG 不认可或认证软件工具；供应方不得声称获得 ASD 批准，或使用相应标志、版权和商标。该来源支持认证与标识边界，不构成规范规则或词典的再分发许可。

官方 [FAQ](https://www.asd-ste100.org/STE_faq.html) 的检索内容说明，检查工具是可选辅助，不能替代规范与作者判断。词面检查不能保证词义、词性或合规。

## 来源可读性

下表记录 2026-10-21 的来源访问范围。搜索索引可见不等于已直接核对网页全文或 Issue 9 原文；本次列出的官方 HTML 均未能直接打开。

| 来源 | 直接打开 | 可用证据及限制 |
| --- | --- | --- |
| [Tools for STE](https://asd-ste100.org/STEsoftware.html)；www 主机同路径 | 403 | 搜索索引可读认证、工具类型及使用边界；不能称已读取官方全文 |
| [软件旧路径](https://asd-ste100.org/software.html) | 403 | 不作为有效规则或授权来源 |
| [官方主页](https://asd-ste100.org/) | 403 | 搜索索引可见 Issue 9 日期及商标编号 |
| [FAQ](https://www.asd-ste100.org/STE_faq.html) | 403 | 搜索索引可见工具可选与认证声明 |
| [Downloads](https://asd-ste100.org/STE_downloads.html) | 403 | 搜索索引可见免费申请 Issue 9；免费获取不能推出再分发授权 |
| [STEMG ToR](https://www.asd-ste100.org/STEMG_ToR.html) | 403 | 搜索索引可见维护职责 |
| [ASD Issue 9 新闻页](https://www.asd-europe.org/news-media/news-events/news/simplified-technical-english-asd-ste100-issue-9/) | 抓取失败 | 不作为本次已直接核对的发布日期证据 |

检索也返回了 Issue 9 PDF 片段，但没有直接打开或逐条核对相关规则，不能由片段推断全套规则、条款编号或授权范围。上述事实以官方可检索内容为限。

## 二手数值与待核实内容

20/25/6（程序性句 20 词、描述性句 25 词、段落 6 句）保持“二手、待核实”。原有二手线索为 [writing-styles](https://github.com/cfcosta/writing-styles/blob/main/asd-ste100/references/writing-rules.md) 与 [ste-prompt](https://github.com/menonpg/ste-prompt/blob/master/RULES.md)，本次未直接核对这两个文件。

这些数值及“一句一条指令、主动语态”的具体适用范围与条款编号，须对照合法取得的 Issue 9 原文核实，不能当本次已核实的规范引文。Concord 可以自行选择 20/25/6 作为项目参数，但必须说明参数归属。

## Concord 设计参数

Concord 的中文阈值、Han 比例、混排策略、token、缩写集合、代码权重、词面匹配与豁免都属于项目设计，不能标为 ASD 的中文规则或认证实现。

受控动作词检查只报告命中词面，不证明指令数量；被动形式候选不证明完整语法。中文和英文都需要项目语料记录误报与漏报。候选的具体政策与验收见[受控写作规则](../../design/controlled-writing/README.md)。

## 使用边界

Concord 使用自己的规则名与项目自有词表，不随包分发 ASD-STE100 原文、词典或商标标志，不宣称获得认证或符合该规范。批准词表由项目维护，不从免费申请机制推导复制与再分发权利。

工具来源、项目参数与规范事实分别标注；无论候选选择何种 linter，建议和门禁都不能作为合规证明。
