# 为已有代码补写 Spec 并纳管存量测试

## 用户目标

维护者在已有代码、测试与旧文档的仓库中初始化 Concord 后，按批次把现有对外行为写成 Feature 与 Use Case，将意图不明的行为记为 Issue，并把存量代码和测试关联到 Spec。

## 起始状态

- 仓库已走完[初始化后开始写 Spec](start-writing-specs.md)，维护者选择了“为已有代码补写”，agent 已读取 `concord --skill docs-from-code`。
- 仓库中已有实现源码、测试文件与原有文档。

## 完整路径

1. 盘点入口并实际运行，写下第一个 Feature 与 Use Case。 {#write-verified-behavior}

   agent 盘点使用者能接触到的命令、公开 API、页面、配置文件与现有测试，按使用者目标分成候选 Feature，交给维护者确认。每次只写一个 Feature：

   ```sh
   concord new feature cart --title "购物车" --pages cli,use-case
   concord new use-case add-item --feature cart --title "加入商品"
   ```

   谁用它、解决什么问题先问维护者；命令输出和行为在临时目录实际运行现有程序后复制，不凭阅读代码推测（[只声称证明过的](../../../taste.md#t-5)）。

2. 把读不出意图的行为记为 Issue。 {#record-unclear-behavior}

   阅读代码或运行测试时，若遇到两个入口对同一输入结果不同、报错与旧文档矛盾或疑似绕过校验的分支，不把它直接写成 Spec 规则，而是创建 Issue 记下现象与复现命令：

   ```sh
   concord new issue negative-quantity --title "加入负数数量时未拒绝"
   ```

   由维护者判断它是正式需求还是缺陷：确认为需求后再写进 Use Case 并关闭 Issue；确认为缺陷则留作待修复的 Issue。

3. 关联已有实现与测试，清点未关联的存量测试。 {#link-existing-sources}

   用 `concord code marker` 与 `concord test marker` 生成注释，加到这一批 Feature 对应的实现源码与现有测试上。配置了 adapter 时，收集原生测试清单并查看剩余缺口：

   ```sh
   concord test discover
   concord --fresh trace gaps
   ```

   按[找出没有关联 Use Case 的测试](../../local-sdlc/use-case/find-unlinked-tests.md)查看 `unlinkedTests`，随后续 Feature 批次逐步关联或清理。

4. 整理原有文档、提炼术语与品味并运行检查。 {#absorb-legacy-docs}

   仓库原有的文档在初始化后保留原样。把其中仍然成立的产品行为并入对应 Feature，可复用的排障经验与历史取舍移入 `memory/`；代码和文档中混用的领域名词写进 `docs/concepts.md`，把弃用的同义词列入旧写法；反复出现的工程偏好经维护者确认后写入 `docs/taste.md`。每完成一批运行一次检查：

   ```sh
   concord check
   ```

## 结果

存量能力按 Feature 逐批纳管，存疑行为在 `docs/issues/` 中等待维护者拍板，已纳管的测试与实现可通过 `concord show` 反查。

| 情形 | 结果 |
| --- | --- |
| 代码实际运行结果与旧文档描述不一致 | 示例与现状按实际运行记录，差异记入 Issue 或请维护者当场决定目标行为 |
| 存量测试只验证构建、架构依赖或基准测试等仓库维护机制 | 为该机制创建 `docs/engineering/<t>/`，让测试标记指向 Engineering 文档包 |
| 仓库里还有尚未整理的说明文档 | 留在文档包外（例如 `docs/guides/`），`check` 不把包外普通文档判为 `UnknownPageKind` |
| 源码或测试不在默认的 `src/`、`test/`、`tests/` 目录 | 按[安全维护项目配置](maintain-project-config.md)在 `concord.config.ts` 中配置 `sourceRoots` 与 `testRoots` |

## Spec 来源

- [初始化后开始写 Spec](start-writing-specs.md)
- [找出没有关联 Use Case 的测试](../../local-sdlc/use-case/find-unlinked-tests.md)
- [命令体验](../../local-sdlc/cli.md)
