# 照着 Spec 实现

实现指定的 Feature、Use Case 或步骤，让代码、测试和 Spec 一致。不改 `docs/` 下的 Spec。

1. 读 Spec：`concord show <Use Case>` 查看步骤、已关联的代码与测试；读相关的 cli、library 与 architecture 页。
2. 先确认 Spec 够用：命名、行为、错误和验收方式都已写明。缺失、自相矛盾或与代码事实冲突时，停下依赖它的部分，把 Spec 位置、证据和可选做法交给写 Spec 的人；不要自行决定公共命名、错误语义或数据结构，其余不受影响的部分继续。
3. 实现并写测试。测试加标记指向 Use Case 或步骤（`concord test marker`），实现加代码声明（`concord code marker`），语法见 `concord --skill test` 与 `concord --skill code`。
4. 运行项目自己的测试与 `concord check`；`concord trace gaps` 确认没有留下未关联的步骤。把 Spec 中标为预期输出的示例与实际运行对照，不一致时报告，不改 Spec。

交付时给出改动、运行的命令与结果、仍未满足的 Spec 条目。测试通过不等于 Spec 满足，逐条对照后再说完成。
