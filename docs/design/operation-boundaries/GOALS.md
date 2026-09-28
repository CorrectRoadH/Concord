# Goals

## G1: Local operations

Memory/Issue 查询和正文维护按所属来源读取；指定路径的注释生成只验证目标 owner、归属链与显式引用。无关文档或标记损坏不阻断这些操作。

## G2: Read concurrency

CLI 与 Web 的普通查询声明只读访问，使用乐观来源快照；普通写入只在提交阶段独占，恢复与证据签发保持独占。操作类别不再借用 dry-run 表达。

## G3: Explain recovery

死 publication owner 可显式回收；返回结果说明回收 token、journal 结果以及 runner 是否仍阻断发布。clean 仅表示检查时没有待恢复发布事务与阻塞资源，不保证未来无并发者。

## G4: Complete diagnosis

全局 check 收集各 owner 的解析错误，保留其他有效记录并返回失败；局部成功不表示全局检查通过。
