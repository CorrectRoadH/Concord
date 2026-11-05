# 写 Spec

把一个需求写成实现者不用再问的 Spec。只改 `docs/`，不写实现代码。

1. 读现状：`concord list feature`、`concord show <相关 Feature>`，读 `docs/taste.md` 与生效的 `concepts.md`。找出需求落在哪个 Feature；没有合适的就新建。
2. 写行为：Feature README 像使用教程；每个用户目标一个 Use Case，写起始状态、带 `{#id}` 的步骤、要运行的命令或调用、看到的输出。同一路径的输入变化和错误写成表格。尚未实现的输出标为预期输出。
3. 定下实现者会问的事：公共命名、输入输出字段、具名错误与退出码写在 cli 或 library 页；实体归属、数据流、不变量与资源生命周期写在 architecture 页。新名词先进 `concepts.md`。
4. 有几种做法都说得通、需要维护者取舍时，写 `docs/design/<d>.md` 列出做法与代价，请维护者决定；定下后把规则写进 Spec 并删除这一页。不难取舍的直接写进 Spec。
5. 运行 `concord check`，处理全部 finding。

交付时说明改了哪些页、定下了什么、还有哪些问题等维护者决定。页面写法的完整规则见 `concord --skill document`。
