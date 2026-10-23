# 契约写法与源码关联

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 读者只读 `local-sdlc/use-case/resolve-with-command-evidence.md` | 能写出 red 收据、green 收据、`memory resolve` 成功和 `InvalidRedEvidence` 的断言 |
| C2 | 行为页出现 HawDB、journal、preimage 或内部模块名 | 规则指明这些内容属于 architecture 页；公开 JSON 字段与错误码留在行为页 |
| C3 | 把缓存引擎换成另一种实现，可观察行为不变 | 只修改 architecture 页；行为页与指向行为的测试标记不变 |
| C4 | Use Case 有三个带 `{#id}` 的步骤 | `use-case steps` 与 `trace show` 区分每个步骤、整个 Use Case 与非步骤关联 |
| C5 | `code locate <file> --line <n>` 落在实现某一步的函数内 | 返回的声明指向该步骤 anchor |
| C6 | 新会话的 Agent 只读 `concord --skill` 与 `--skill document` | 能选择写行为页还是 architecture 页，并选择声明的作用域与目标 |
| C7 | 一个文件只服务一个 Feature 的共享基础设施，且没有更精确的适用目标 | 允许文件级声明指向 Feature README |
| C8 | 只保证内部不变量的代码或测试，如原子发布 | 不变量对使用者可观察时，行为页写出保证并关联；否则关联 architecture 或 lifecycle 页的 anchor |
| C9 | 一个端到端测试验证跨三个步骤的完整结果 | 测试指向整个 Use Case，不要求拆成逐步骤标记 |
| C10 | 仓库维护机制的代码，如自举检查 | 指向 Engineering owner，不伪装成产品步骤 |
| C11 | 一个共享函数服务两个 Use Case 的行为 | 声明使用两条 implements |
| C12 | 功能尚未实现，作者写 cli 页 | 示例标为预期输出；交付验收核对实际运行，运行记录进入 Memory |
| C13 | 修改步骤文字，不改变行为 | 保留 `{#id}`，关联与测试 ID 不变 |
| C14 | 未命名测试的目标从整个 Use Case 改为一个步骤 | 测试 ID 随目标改变，旧收据不能关闭新目标的 Problem，需重新取证 |
