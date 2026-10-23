# 宪法的结构、关联与写法

## Decision

Undecided.

作者推荐 link-owned，等待独立审查。

## Rationale

两案共用 ID 语法、条款写法与宪法格式迁移，G1、G2、G4、G5 相同。差别在 G3：读者要知道哪句话依据哪条规则。link-owned 让引用定位到页面与行，附页同样适用；metadata-owned 的适用关系只到 owner，附页无法声明。link-owned 的代价是扫描范围更大，迁移要改 36 个 owner，并取消三处公开接口。

G4: 条款写法依靠审阅执行。接受这个缺口：词面规则可以用 `roots: ["docs/constitution.md"]` 只作用于宪法，但宪法中明确采用的技术约束本身含引擎与库名，“一款一项规则”也无法由词面判断。结构规则（ID、链接）由工具检查，语义由审阅判断。

## Rejected Options

metadata-owned：适用关系只到 owner，附页无法声明，G3 不满足。

## Residual Risks

- 取消 `constitutionRefs` 与 `--constitution-ref` 会破坏依赖它们的脚本与接入项目，需要迁移命令与具名诊断。
- 迁移生成的数字款 ID 可读性差；ID 不改名，链接文字承担可读性。
