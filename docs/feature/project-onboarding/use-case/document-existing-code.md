# 为已有代码补写 Spec 并纳管存量测试

## 用户目标

维护者在已有代码、测试与旧文档的仓库中初始化 Concord 后，按批次把现有对外行为写成 Feature 与 Use Case，将意图不明的行为记为 Issue，并把存量代码和测试关联到 Spec。

## 起始状态

- 本次目标包括为已有代码补写 Spec，agent 已按[写作入口](start-writing-specs.md)读取 `concord --skill docs-from-code` 与 `concord --skill document` 中的目录树和完整示例。
- 仓库中已有实现源码、测试文件与原有文档。

## 完整路径

1. 理解已有约定，写下第一个 Feature 与 Use Case。 {#write-verified-behavior}

   agent 先读项目说明、相关旧文档、品味与术语，再检查使用者接触的页面、命令、公开接口与相关测试。按本次目标选择代表性 Feature，参照[写作示例](../../../guides/spec-examples.md)直接编辑 README 和一条 Use Case；也可用模板创建骨架：

   ```sh
   concord new feature cart --title "购物车" --pages ui,use-case
   concord new use-case add-item --feature cart --title "加入商品"
   ```

   已明确的用户目标直接沿用；关键歧义才询问。页面按读者需要选择，GUI 用法从界面开始。行为与示例在隔离环境核对，未执行的结果标为预期结果，不凭代码阅读声称验证通过（[只声称证明过的](../../../taste.md#t-5)）。

   正文先核对上手是否服务主要使用者、步骤是否推进同一个目标、内部机制是否归属架构页，再扩写。相关术语与系统边界随本批文档一起补齐。

2. 把读不出意图的行为记为 Issue。 {#record-unclear-behavior}

   阅读代码或运行测试时，若遇到两个入口对同一输入结果不同、报错与旧文档矛盾或疑似绕过校验的分支，不把它直接写成 Spec 规则，而是创建 Issue 记下现象与复现命令：

   ```sh
   concord new issue negative-quantity --title "加入负数数量时未拒绝"
   ```

   由维护者判断它是正式需求还是缺陷：确认为需求后再写进 Use Case 并关闭 Issue；确认为缺陷则留作待修复的 Issue。

3. 在接入范围内关联已有实现与测试。 {#link-existing-sources}

   文档路径和语义稳定后，若任务包含存量接入，用 `concord code marker` 与 `concord test marker` 生成注释，加到真正实现或断言该行为的源码与测试上。只写文档的任务跳过源码标记和配置修改。按当前 Feature 查看关系与写作问题；需要盘点全部测试且配置了 adapter 时，再运行发现：

   ```sh
   concord --fresh trace gaps cart
   concord docs check docs/feature/cart
   concord test discover
   concord --fresh trace gaps
   ```

   按[找出没有关联 Use Case 的测试](../../local-sdlc/use-case/find-unlinked-tests.md)查看 `unlinkedTests`。缺口如实保留，不为消除缺口关联无关测试或扩展本次实现范围。关联不表示覆盖。

4. 整理原有文档、提炼术语与品味并运行检查。 {#absorb-legacy-docs}

   仓库原有文档在初始化后保留原样。按本次范围吸收有效约定，重复规则明确归属；过时或存疑文档不擅自删除。可复用经验归 `memory/`，进度留在交接中。品味只提炼维护者采用的判断标准，具体机制归架构页。交付前运行检查：

   ```sh
   concord check
   ```

## 结果

本次范围内的能力有可读的 Spec，存疑行为留在 `docs/issues/`。交付说明写作范围、未决问题、未验证结果和关联缺口；已纳管的测试与实现可通过 `concord show` 反查。

| 情形 | 结果 |
| --- | --- |
| 代码实际运行结果与旧文档描述不一致 | 示例与现状按实际运行记录，差异记入 Issue 或请维护者当场决定目标行为 |
| 用户追加新增能力 | 按 `concord --skill spec` 设计新增目标，只调查相关现状，不等待整仓补写或关联结束 |
| 存量测试只验证构建、架构依赖或基准测试等仓库维护机制 | 为该机制创建 `docs/engineering/<t>/`，让测试标记指向 Engineering 文档包 |
| 仓库里还有尚未整理的说明文档 | 留在文档包外（例如 `docs/guides/`），`check` 不把包外普通文档判为 `UnknownPageKind` |
| 源码或测试不在默认的 `src/`、`test/`、`tests/` 目录 | 按[安全维护项目配置](maintain-project-config.md)在 `concord.config.ts` 中配置 `sourceRoots` 与 `testRoots` |

## Spec 来源

- [初始化后开始写 Spec](start-writing-specs.md)
- [找出没有关联 Use Case 的测试](../../local-sdlc/use-case/find-unlinked-tests.md)
- [命令体验](../../local-sdlc/cli.md)
