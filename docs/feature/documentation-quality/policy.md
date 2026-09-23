# 按目录声明术语与写作政策

```text
docs/
  concepts.json                    # 全局概念定义
  concord-writing.json             # 全局写作政策，可选
  feature/payments/
    concepts.json                  # payments 的局部概念
    concord-writing.json           # payments 的局部规则
    examples/concord-writing.json  # 更小的目录范围
  engineering/build/
    concepts.json                  # build 的局部概念
```

Concord 识别 docs 下精确命名的 concepts.json 与 concord-writing.json，排除 docs/_template、.git 和 node_modules。目录决定作用域，不在 JSON 重复保存 scope。其它 JSON 不获得写入授权；聚合从来源派生，不回写全局文件。全局概念与局部概念均有来源路径，局部定义不会自动升级为全局。

## 概念定义

```json
{
  "format": "concord.concepts/v1",
  "concepts": [
    {
      "id": "feedback",
      "definition": "等待调查的产品或工程观察。",
      "names": {
        "zh": {"preferred": "反馈", "aliases": ["反馈项"], "deprecated": ["工单"]},
        "en": {"preferred": "Feedback"}
      }
    }
  ],
  "imports": []
}
```

id 在本文件内唯一，完整身份为 canonical catalog path#id。定义至少有一种语言；preferred 是首选名，aliases 是允许的名称，deprecated 才派生禁词。同一概念内部的这些名称不得互相冲突。ASCII 名称按忽略大小写和单词边界匹配，其它名称按字面匹配。

全局和祖先目录的定义自动适用；imports 可显式引用其它目录的直接定义，例如 docs/feature/payments/concepts.json#payment。引用不递归导入另一文件的 imports，也不复制定义。移除或改名被引用的 ID 会被拒绝。不同兄弟目录的同名概念可以并存；有效范围相交的歧义携带双方来源，不静默覆盖。

Markdown 适合解释概念关系、场景和例子。结构化定义只在 JSON 维护；旧 Markdown 表格不再作为运行时术语来源。

## 写作政策

```json
{
  "format": "concord.writing/v2",
  "bannedTerms": [
    {"term": "旧称", "use": "推荐表达", "why": "避免歧义", "exempt": ["docs/feature/payments/history"]}
  ],
  "sentenceLength": 140,
  "paragraphLength": 320,
  "unusedConcepts": true,
  "svgTerms": true
}
```

roots 可省略：全局默认为 docs，局部默认为所在目录。全局 roots 可显式选择仓库其它文档目录；局部 roots 不得越出所在目录。所有路径均为仓库相对路径，不自动按文件位置重新解释。

默认 `concord docs check --json` 选择全部政策 roots，加上没有同目录政策的概念目录；因此局部 owner 可以启动被全局窄 roots 排除的目录扫描。没有政策也可以检查概念。没有任何相关来源时具名报错；明确选中的根没有文档时也不静默通过。

选文件与应用规则是两个步骤。对已经选中的文件，全局和祖先政策共同生效；roots 不取消祖先约束，单条禁词的 roots/exempt/allowIn 只限制它自身。禁词累加，长度和 SVG 选项采用最近目录的显式值：省略表示继承，数字阈值或 svgStyle 的 null 表示清除，布尔 false 表示关闭。

`--rules` 指向受管政策时，仅用该政策的 roots 选文件，仍合成这些文件的祖先与后代政策。指向非受管路径时是独立只读 profile，仅用显式政策与有效概念，不合成其它写作政策。报告说明实际模式和选择范围。

冲突按实际适用的文件与表达位置判断，互不相交的 roots/豁免不构成冲突。相同命中可去重，但必须保留全部适用来源；冲突命中不任意挑选一条替换建议。允许别名与其它有效概念的弃用/禁词相撞也须报告。

## 使用统计与输入快照

概念使用按完整概念身份统计，只读取该概念实际适用的所选正文。允许名称算使用，弃用名称不证明正确使用；显式 import 是原概念的有效使用。定义和生成汇总不算使用。同一概念最多产生一条 unusedConcept 诊断，不用兄弟目录的同名概念替它证明使用。

SVG 标签出处仅来自最近局部术语/政策目录内的所选正文及该 SVG 有效的概念；没有局部 owner 时使用所选全局根。不得借用兄弟局部目录的正文。Markdown/MDX/SVG 解析、长度和路径安全边界与正文检查契约一致。

报告绑定政策、概念、文件集合、配置、正文和 CSS 的输入摘要；读取期间变化则拒绝结果。Web 只展示某次已保存输入的历史快照，不称为当前通过。

## 工具管理与恢复

通过 writing 与 concepts 工具及 Web 编辑来源，使用完整 owner 摘要保护修改。show 区分 missing/valid/invalid，安全读取的无效原文可以显式修复；危险路径和读取失败不会伪装为空态。正文输入可来自临时文件或 stdin，不直接绕过工具改受管 JSON。

publication 与 recovery 双向校验精确路径、具名操作、唯一有效 after 和配置绑定。concepts 写入还保存其它 catalog 的完整集合与原文摘要；事务中断后新增、删除或修改 importer 会拒绝恢复并保留现场。prepared 恢复精确 before（包括原来的无效 bytes），committed 保留已提交内容，不要求 before 已经符合当前 Schema。

init 只在缺失时创建空的全局 concepts.json，并绑定真实的新配置初始化；保留已有概念文件的全部字节。这个例外不允许局部 catalog、非空目录定义或任意 JSON 混入 init。

## 从 writing/v1 迁移

普通检查遇到 v1 返回 WritingMigrationRequired，不自动解释旧概念表。先用 show 获取旧政策原文与 digest；作者审核概念定义、别名与弃用名，用 concepts.set 保存 JSON；最后用 writing.set 和旧政策 digest 显式替换为 v2。迁移中间阶段仍明确拒绝旧政策检查。

catalog 编辑不依赖写作政策解析，因此现存 v1 不会阻断迁移。各无效来源可逐项修复，但已知引用不能被破坏。保留旧 Markdown 解释/历史时应明确其不再是术语定义来源。禁止从名称自动编造 definition，也不把全部 aliases 自动当成 deprecated。

升级前若存在 v1 journal，先用匹配的旧 CLI 完成恢复；新运行时不暗中恢复旧事务或改写其证据。详细合成、修复及恢复条件见[采用方案](../../design/scoped-terminology/plans/directory-owned/README.md)。

## CLI 示例

```sh
concord writing index --json
concord concepts index --json
concord concepts show --path docs/feature/payments/concepts.json --json
concord writing show --path docs/feature/payments/concord-writing.json --json

# 仅在目标缺失时使用 null；已有来源必须使用 show 返回的 digest。
concord concepts set --path docs/feature/payments/concepts.json \
  --body /tmp/reviewed-concepts.json --expected-digest null
concord writing set --path docs/feature/payments/concord-writing.json \
  --body /tmp/reviewed-policy.json --expected-digest null
concord docs check --rules docs/feature/payments/concord-writing.json --json
```

`--body -` 接受 stdin；根命令的 `--dry-run` 验证同一规划但不保存来源。删除条目通过带最新摘要的整份 catalog 更新完成，不能移除仍被引用的定义。
