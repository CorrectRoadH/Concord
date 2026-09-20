# 实现声明自动派生查询引用

本页记录自动派生方案及用户明确要求的 beta 入口简化；采用状态以 Design owner 为准。

## 语法与所有权

`@concord-file`、`@concord-code`、`@concord-begin`、`@concord-end` 均无参数。起始标记后连续的 `@concord-implements <exactRef>` 保持不变。region 仍非嵌套，在同一 statement-list 内包住非空完整语句，按 begin/end 配对。文件和节点最多一份声明，多目标由 implements 表达。

## 派生引用

JSON 的 `id` 字段及 `code:<id>` 边保留，值为 `code-` 加规范元组 SHA-256 前 32 个十六进制字符。元组包含 `concord.code-reference/v1`、canonical 源路径、scope 和定位键；没有行号、正文、关联目标或 worktree 绝对路径。

哈希输入固定为 `JSON.stringify(["concord.code-reference/v1", relativePath, scope, locator])`。file 的定位键固定为空数组。node 的定位键从 SourceFile 的子节点开始，到绑定节点为止；每层是 `[SyntaxKind字符串, staticName或null, 同描述直接兄弟的零基序号]`。直接子节点通过 `ts.forEachChild` 完整枚举，包含未标注节点，回调不得以 truthy 返回值提前结束遍历。

函数、类、方法和变量声明的静态 name 只读取 Identifier、PrivateIdentifier、StringLiteral、NumericLiteral 的文本；ComputedPropertyName 与无名节点统一为 null，不读取表达式原文或求值。单变量语句从唯一变量声明的简单标识符取名。这里的身份算法使用固定元组；任何改变派生语义的后续修改必须升级版本。

region 的定位键为 `[statementListLocator, validRegionOrdinal]`：所在 statement-list 节点使用相同结构路径，SourceFile 使用空路径；顺序号按列表内合法 region 的源码顺序从零开始。body 编辑不作为身份输入；前序 region 插入或删除可以改变后续引用。

定位路径及同描述前序兄弟不变时，重复扫描、纯空白/注释变化、命名节点体内普通修改、implements 目标修改不改变引用。文件移动、改名、作用域改变、同描述兄弟或 region 次序改变可能改变引用，旧引用也可能被当前位置的另一声明复用。查询引用不是持久历史身份、CAS token 或授权凭证。自动消费者每次重新 list/locate，并核对返回的文件、符号和范围；不能把旧引用的查询成功视为历史连续性证明。

## 当前入口

`code annotate --scope ... --contract ...` 和 `code.annotate` action 不接收 ID，仅返回 scope/snippet。查询使用 `code list` 与 `code locate`，删除按 ID 查询的 CLI 及其专用处理逻辑。Web 删除 ID 输入和身份详情展示，以符号、文件、范围与关联契约呈现；保留 Engineering 与当前响应式布局。review 用符号及文件位置显示实现，图与 JSON 仍可使用内部自动引用。

范围标记不接受参数，按当前语法报告普通无效注释。无效 begin 仍参与边界配对，不能跳过它并让 end 消耗外层 begin。

项目尚未发布，直接维护当前协议，不增加旧语法兼容、迁移分支、弃用命令或引用别名。仓库自身的真实标记移除参数并保持原范围与关联，不改外部消费者。普通扫描不改写文件；测试身份及证据协议不在此变更范围。

## 验证

保留真实注释与 AST 安全绑定；同名、匿名、跨文件及 region 的区分和稳定边界由 parser 测试验证。打包 CLI 覆盖三种 scope、无 ID action、list/locate、Engineering、反查与测试证据隔离；浏览器覆盖无需填写 ID 的片段生成与常显响应式布局。
