# 应用受控写作规则

## 场景

作为文档维护者，我希望程序性文本与描述性文本使用不同的句长上限，中文与英文分别计数，并可以选择启用受控动作词、批准词与被动形式检查。

## 主流程

1. 在 `concord.writing/v3` 政策的 `controlled` 对象中声明阈值、词表与开关，按目录作用域合成。
2. `concord docs check` 与 `concord check` 同时执行字符长度路径与 controlled token 路径。

## 验收

Schema、目录合成、抽取、分句、计数、词表匹配与错误见[受控写作规则](../policy.md#受控写作规则)。词法规则默认关闭；finding 只陈述观察到的词面。Concord 不分发 ASD-STE100 原文或词典，不宣称符合该规范，见 Research。

以下场景使用构建、打包后安装到隔离 Git 消费者的公开 CLI；测试不复制抽取与合成算法，词法场景显式开启对应开关。

| 场景 | 输入与操作 | 结果 |
| --- | --- | --- |
| C1 | 有序列表直接段落 22 个英文 token，程序性上限 20 | `proceduralSentenceLength`，计数 22 |
| C2 | 普通段落、无序项、引用各 22 个英文 token，描述性上限 25 | 无句长 finding；引用内列表也用描述性阈值 |
| C3 | 中文程序性句含 30 个汉字与 3 个行内代码，上限 30 | 计为 33；代码内容不命中动词和批准词 |
| C4 | 程序性句“删除标记后返回列表”，词表有删除、返回 | `multipleInstructions`，“命中多个受控动作词”，两次 |
| C5 | 程序性句未命中动作词，requireVerb 为 true | `unapprovedProceduralVerb`，“未命中项目受控动作词” |
| C6 | `The cache is cleared by recover.`，en 语态开启，分词含 cleared | “命中被动形式候选”，不声称完成语法分析 |
| C7 | “被动模式”，zh 语态开启且 allowIn.zh 含被动 | 不报告；清空豁免后报告“被” |
| C8 | 一段 7 句，paragraphSentences 为 6 | `paragraphSentences`，7 |
| C9 | 根 en 阈值 20/25，子目录仅程序性 null | 程序性关闭，描述性 25；来源指向各自叶子 |
| C10 | 无 controlled 与步骤标记的 v3 政策 | legacy finding 的规则、位置、计数和消息与只含长度规则的政策相同；非 v3 政策返回 `InvalidWritingPolicy` |
| C11 | 步骤第一段末尾带 `{#read-token}`，与无标记副本比较 | 两条路径结果与副本相同；代码中的相同文本不认作步骤 |
| C12 | listItem 有两段并嵌套无序列表，再嵌套有序列表 | 每段只计一次；最近列表决定类型，父段不累计子段 |
| C13 | 同文含链接、目标 URL、图片、标题、表格、代码块与 MDX 表达式 | controlled 只取 paragraph 显示文本 |
| C14 | `3.14`、`U.S.`、`don't`、`state-of-the-art`、`v3`、`café` | token 数 1、2、1、1、2、1；缩写与小数不切句 |
| C15 | 纯数字句、纯代码句、标点片段、汉字比例恰为 1/2 的混排 | 数字句与代码句各成一句，分母 0 选 en；标点片段不成句；1/2 选 zh |
| C16 | 技术词多的中文在 auto 下选 en，再显式设 zh | token 总数相同，阈值与词表来源改变 |
| C17 | 子目录 `verbs.en=[]`，祖先 singleInstruction 为 true | `InvalidWritingPolicy`，列出空表与开关来源 |
| C18 | 子目录 `procedural=null`，更深目录只声明 requireVerb 为 true | 更深目录因无词表失败，不取回清除前的祖先表 |
| C19 | approvedWords 开启且 en 为空，句首 Execute | `unapprovedWord`；Execute 与 execute 同样处理 |
| C20 | en 表只列 write 与显式 forms，另有不同 lemma 的同形 form | 只匹配列出的形式；同形冲突被拒绝 |
| C21 | “返回包含删除记录的列表”“写入失败时拒绝请求”“被动模式”、`read the read result` | 保留实际词面命中并记录语义误报；allowIn 可排除 |
| C22 | 冷、暖、缓存损坏、清空后检查同一来源 | finding、完整性与退出码一致；不启动 adapter 或 LSP |
| C23 | writing set 准备后目标被编辑、存在无法解码的 journal、存在未知 publication owner | 分别拒绝 CAS、阻断写入并保留现场、保留未知现场 |
| C24 | writing set、Web action 与 standalone profile 提交相同非法叶子 | 同一 Schema 与具名错误；未知字段、null 与空数组行为一致 |
| C25 | 单表 4097 个形式、极端重叠匹配或超过 finding 上限 | `WritingBudgetExceeded`，complete 为 false，非零退出 |

性能按[性能预算](../policy.md#性能预算)测量，结果记入 Memory。
