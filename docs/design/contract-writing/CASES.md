# 契约写法与源码关联

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 读者只读 `local-sdlc/use-case/resolve-with-command-evidence.md` | 能写出 red 收据、green 收据、`memory resolve` 成功和 `InvalidRedEvidence` 的断言 |
| C2 | 行为页出现 HawDB、journal、preimage 或模块名 | 写作指南指明这些内容属于 architecture 页 |
| C3 | 把缓存引擎从 HawDB 换成另一种实现，行为不变 | 只修改 architecture 页；行为页与测试标记不变 |
| C4 | Use Case 有三个带 `{#id}` 的步骤 | 每个步骤可列出实现它的 node/region 声明与验证它的测试 |
| C5 | `code locate <file> --line <n>` 落在实现某一步的函数内 | 返回的声明指向该步骤 anchor，而不只是 Feature README |
| C6 | 新会话的 Agent 只读 `concord --skill` 与 `--skill document` | 能按规则选择写行为页还是 architecture 页，选择声明的作用域与目标 |
| C7 | 一个文件只包含一个 Feature 的共享基础设施 | 允许文件级声明指向 Feature README |
| C8 | 内部不变量的单元测试，如原子发布 | 若不变量对使用者可观察，行为页写出该保证并让测试指向它；否则测试指向 architecture 页的 anchor |
