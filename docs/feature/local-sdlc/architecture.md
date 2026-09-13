# 架构

## 编译管线

Concord 从严格 YAML frontmatter 的 Markdown owner 和 TypeScript AST 可识别的测试声明读取事实，解析 canonical path 与 anchor，验证目标类型、重复关系和循环，再生成 trace、review 与检查结果。SQLite 只缓存解析结果和投影，命中时仍严格解码并核对路径集合、摘要与版本。

## 执行管线

只有 `test run` 启动仓库命令。runner argv 逐参数替换 `{file}`、`{name}`、`{pattern}`，不经过 shell；timeout、取消和输出上限都由受 Scope 管理的进程组清理。收据记录 command outcome 与 observed execution，未知或全跳过不会被包装成 case passed。

## 写入管线

文档 mutation 先解析完整变更集和 preimage，再持久化 journal，以同文件系统临时文件和原子 rename 发布。读取发现未完成 journal 时要求显式 recover；内容既不匹配 preimage 也不匹配 planned digest 时拒绝覆盖外部编辑。

## 信任边界

仓库作者负责 runner 命令及 sourceFiles 声明。摘要能发现声明范围内的漂移，但不证明忽略依赖、外部服务、完整环境或断言充分性。工具不自动触碰生产、远端或凭据。
