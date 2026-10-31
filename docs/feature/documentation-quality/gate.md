# 合并检查

`concord check` 一次运行关系检查和写作检查：Spec、测试标记、代码声明与链接是否对得上，正文有没有用错的词、超长的句子或没被用到的概念。写作部分与 `concord docs check` 使用同一份 `writing.md` 与 `concepts.md`。

- 结果：JSON 的 `ok` 在没有任何 finding、且全部输入都读到时为 true。`complete` 为 false 表示有文件没能读取，结论不完整。每条 finding 带 `category`（`relation` 或 `writing`）与具名 code；`checks.relations` 与 `checks.writing` 分别给出 `ok` 与 `complete`。
- 退出码：`ok` 为 true 时退出 0，否则退出 1。
- 没有任何 `writing.md` 时，写作部分只检查术语，不检查长度与不用的词。
- CLI、结构化 action、Web 与 Herdr mod 看到的是同一份结果。
- 检查失败不妨碍读取、直接编辑或运行其它命令。
