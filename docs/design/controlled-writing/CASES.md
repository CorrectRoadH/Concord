# 受控写作规则

以下为候选的公开入口验收契约，使用构建、打包后安装到隔离 Git 消费者的 CLI。测试不得复制核心抽取与合成算法；只在外部进程边界使用 fake。所有词法场景都须显式开启相应开关。

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 有序列表直接段落有 22 个英文 token，程序性上限 20 | `proceduralSentenceLength`，计数 22 |
| C2 | 普通段落、无序项、引用分别有 22 个英文 token，描述性上限 25 | 无句长 finding；引用内列表也使用描述性阈值 |
| C3 | 中文程序性句含 30 个汉字与 3 个行内代码，上限 30 | controlled 计为 33；代码内容不命中动词和批准词 |
| C4 | 中文程序性句写“删除标记后返回列表”，词表有删除、返回 | `multipleInstructions` 写“命中多个受控动作词”，出现两次 |
| C5 | 程序性句未命中动作词，requireVerb=true | `unapprovedProceduralVerb` 写“未命中项目受控动作词” |
| C6 | `The cache is cleared by recover.`；en 语态开启，分词表含 cleared | 报告“命中被动形式候选”；未声称完成语法分析 |
| C7 | “被动模式”，zh 语态开启且 allowIn.zh 含被动 | 不报告；清空该豁免后报告字符“被” |
| C8 | 一个段落有 7 句，paragraphSentences 为 6 | `paragraphSentences`，句数 7 |
| C9 | 根 en 阈值 20/25，子仅程序性 null | 程序性关闭，描述性 25；来源指向各自叶子 |
| C10 | 合法 v2，无 controlled、无步骤标记，执行显式迁移 | 除 format 外字段相同，legacy finding 的规则、位置、计数和消息逐项相同；普通入口拒绝 v2 |
| C11 | 合法步骤第一段末尾带 `{#read-token}`，正文与无标记副本相同 | 两条路径的长度及词表结果与副本相同；代码中的相同文本仍是代码，不认作步骤 |
| C12 | listItem 有两段并嵌套无序列表，再嵌套有序列表 | 每段只计一次；最近列表决定程序性/描述性，父段不累计子段 |
| C13 | 同文含链接显示文本、目标 URL、图片、标题、表格、代码块与 MDX 表达式 | controlled 只取声明的 paragraph 显示文本；代码块、目标、图片等均不计入；legacy 按独立规则验证 |
| C14 | `3.14`、`U.S.`、`don't`、`state-of-the-art`、`v3`、`café` | token 数分别为 1、2、1、1、2、1；缩写与小数不在内部切句 |
| C15 | 纯数字句、纯代码句、空白标点片段与 Han/Latin 混排 | 数字句与代码句各形成一句，语言分母 0 选 en；标点片段不形成句子；汉字比例恰好 1/2 时选 zh |
| C16 | 技术词多的中文在 auto 下选 en，再显式设 zh | token 总数相同，阈值与词表来源改变；不声称自动语言正确 |
| C17 | 子目录 `verbs.en=[]`，祖先 singleInstruction=true | `InvalidWritingPolicy`，列出空表与开关来源；不会自动关闭规则 |
| C18 | 子目录 `procedural=null`，更深目录只重声明 requireVerb=true | 子目录清除整子树；更深目录因无词表失败，不重新取得清除前祖先表 |
| C19 | approvedWords.enabled=true 且 en=[]；句首 Execute 未在豁免中 | `unapprovedWord`；Execute 与 execute 同样处理；enabled=false 才关闭 |
| C20 | en 表只列 write 与显式 forms，另含不同 lemma 的同形 form | 只匹配列出的形式；同形冲突严格拒绝，不自动追加 -s/-ed/-ing |
| C21 | “返回包含删除记录的列表”“写入失败时拒绝请求”“被动模式”与 `read the read result` | 开启检查后保留实际词面命中，分别记录语义误报；按规则 allowIn 可明确排除，不能称指令或语态判定正确 |
| C22 | 冷、暖、缓存损坏、清空四种状态检查同一来源 | finding、完整性与退出码一致；不启动 adapter、LSP 或建议进程 |
| C23 | 迁移准备后目标被编辑、存在旧 journal、存在未知 publication owner | 分别拒绝 CAS、要求匹配 CLI 恢复、保留未知现场；不静默覆盖，不自动升级事务 |
| C24 | 使用 writing set、Web action 与 standalone profile 提交相同非法叶子 | 同一 Schema 和具名错误；未知字段、null 清除、空数组行为一致 |
| C25 | 单表 4097 形式、极端重叠匹配或超过 finding 上限 | `WritingBudgetExceeded`、complete=false、非零退出；不以截断结果宣称完整 |
| C26 | 执行外部建议后，再以建议缺失、失败、超时重跑 check | 内置 check 的结果不变；建议报告单独标注失败与来源 |

## 语料验收

语料应包含上述误报样例以及项目真实中英文程序性、描述性和混排段落。由人工标注动作数量与语态，仅用来统计误报、漏报及语言误选比例，不能由检查器自评证明语义准确。

开启词法门禁前，项目记录样本规模、人工标准、各规则 TP/FP/FN、局部豁免及可接受阈值。Concord 预设保持词法开关关闭，不用单独校准句长代替词法语料验证。结果归 Memory，契约只维护验收要求。

## 性能与范围

按[性能预算](plans/policy-rules/architecture.md#性能预算)测量两条路径与最大词表，包括重叠输出失败、冷暖状态及 legacy 对照。样本与基线不满足统一方法时，不把模型推理写作通过证据。

共同契约中的测试 ID、原生标签、原生结果完整性及 LSP 生命周期由相应 Design 验收；本 Design 只验证共享步骤标记、写作独立性和同源缓存不变性，不重复定义它们。
