# Code declarations

代码声明描述实现与 Feature / Use Case / Engineering 的关联。它既不是测试声明，也不是完成或覆盖证明。真实注释是唯一 owner；无需另写关系 JSON。

先读取 `concord.config.ts`。`sourceRoots` 是可选的仓库相对路径数组，缺省 `[]`；仅扫描其中 JS/TS 文件，包括 `.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts`。新项目可用 `concord init --source-root src`，该选项可重复并可与 `--docs-only` 组合。已有项目直接维护配置，不重复 init。`testRoots` 与 `sourceRoots` 可重叠，各标签属于自己的扫描器；`doctor` 提示缺失目录。

## 声明与查询

```sh
concord code annotate --scope node \
  --contract docs/feature/orders/use-case/create-order.md
concord code list --json
concord code locate src/orders.ts --line 12 --json
concord trace show orders --json
concord review render orders
concord check
```

`annotate` 只生成经验证的片段，不编辑源文件，不接收或返回声明 ID。范围标记不带参数，`@concord-implements` 保留显式契约关联。多契约重复 `--contract`，或添加多条相邻 implements；重复 exactRef 拒绝。目标使用 canonical Feature / Use Case / Engineering 路径，也支持 Feature 或 Engineering supporting page 与有效 `#anchor`。不同 anchor 保留独立关联。

```ts
// @concord-file
// @concord-implements docs/feature/orders/README.md

// @concord-code
// @concord-implements docs/feature/orders/use-case/create-order.md
export function parseOrder(input: string) {
  // @concord-begin
  // @concord-implements docs/feature/orders/README.md
  const normalized = input.trim();
  const result = normalized.toLowerCase();
  // @concord-end
  return result;
}
```

## 作用域与边界

- `file`：在首个语句之前，允许前置 BOM、shebang 和许可证注释。每文件最多一份，范围为整个文件。
- `node`：紧邻有函数体的函数声明、类声明、有函数体的方法（含对象方法），或仅绑定一个标识符且 initializer 直接为 arrow/function 的变量语句。包含 export / decorator。签名、重载签名、解构、多变量、匿名回调及任意表达式不支持；用完整语句的 region 表达其它代码段。
- `region`：无参数的 begin / end 成对包住同一语句列表中连续、非空的完整语句，可以包含完整函数；不能嵌套 region、跨函数边界或截断表达式。

每节点最多一份声明。file、node 和 region 可以完整包含；没有覆盖、继承或优先级规则。`locate` 使用 1-based 行号，返回所有包含该行的显式作用域；node/region 范围从实际代码首行到末行，含两端，排除外围标记行。同行其它表达式不作列级区分。

仅使用独占一行的 `//` 标记。起始标记之后的 implements 必须连续且相邻，不能跨空行、其它 family 标签或注释寻找目标。目标之后可以有普通注释或空白，但不能跨另一代码标记或代码 token 绑定到更远节点。字符串、模板、正则、JSX 文本中的类似文字不会注册声明。

## 校验与修正

`code`、`check`、`trace`、`review` 和 `doctor` 校验代码声明及引用；标注文件存在语法错误时不会信任恢复后的 AST。未知 `@concord-*` 在 sourceRoots 中报错，已知测试及 repository profile 标签交给原有 owner。

代码关系每次重新扫描并核对文件集合与摘要，首版不持久缓存。现有测试缓存位于 Git-private 的 `concord/cache.sqlite`（普通 checkout 通常为 `.git/concord/cache.sqlite`，用 `concord cache status` 查询实际位置），仍是可重建投影；清缓存不能修复源码错误。

## 自动查询引用

`list` 和图中的 `id` 是工具内部使用的 `code-…` 自动引用，来自版本、仓库相对源路径、scope 和 AST 结构位置；不写入源码或第二份登记表。按文件与行号使用 `locate` 查询声明；Web 直接显示符号、文件位置和关联契约。

定位路径及同描述前序兄弟不变时，空白、行号、普通函数体与 implements 修改不改变 node 引用。同内容新进程或 clone 可重新得到相同引用。文件移动、改名、改变作用域，以及同描述兄弟或 region 次序变化可能改变引用；旧引用也可能成功指向另一声明，例如删除前方 region 标记后后方 region 接续其序号。

引用只服务于当前扫描，不是永久历史身份、CAS token 或授权。自动消费者应重新 list/locate 并核对文件、符号和范围，不能凭旧引用的查询成功认定历史连续。移动或复制实现后重新查询即可，不需要命名新 ID。

合法配置下，代码标注错误不会阻断 `test list/show/run` 或 `memory resolve`；这些命令继续执行原有文档、测试及证据校验。代码声明不能替代测试、red/green 收据或 Problem fixed 证明。
