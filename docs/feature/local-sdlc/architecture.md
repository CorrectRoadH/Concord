# 架构

## 编译管线

Concord 从严格 YAML frontmatter 的 Markdown owner 和 TypeScript AST 可识别的代码、测试声明读取事实，解析 canonical path 与 anchor，验证目标类型、重复关系和循环，再生成 trace、review 与检查结果。sourceRoots 与 testRoots 分别控制实现和测试扫描；代码声明解析可按文件命中可删除 SQLite 投影，键含 worktree、解析器版本、路径和字节摘要；归属和关系不缓存，始终用当前 Markdown 重算。测试投影仍按整次扫描键缓存。命中都严格解码。

## 自举

本项目的实现文件与关键函数直接声明各自的 Feature / Use Case。共享基础模块关联 Feature，具体行为关联八条 Use Case；repository profile 路由和注释渲染使用显式 region。selfhost 验收要求每条 Use Case 都存在真实实现和测试关联，源码旁的声明仍是唯一 owner，不另存模块到功能的映射表。

## 执行管线

只有 `test run` 启动仓库命令。runner argv 逐参数替换 `{file}`、`{name}`、`{pattern}`，不经过 shell；timeout、取消和输出上限都由受 Scope 管理的进程组清理。收据记录 command outcome 与 observed execution，未知或全跳过不会被包装成 case passed。

## 写入管线

文档 mutation 先解析完整变更集和 preimage，再持久化 journal，以同文件系统临时文件和原子 rename 发布。读取发现未完成 journal 时要求显式 recover；内容既不匹配 preimage 也不匹配 planned digest 时拒绝覆盖外部编辑。

## 信任边界

仓库作者负责 runner 命令及 sourceFiles 声明。摘要能发现声明范围内的漂移，但不证明忽略依赖、外部服务、完整环境或断言充分性。工具不自动触碰生产、远端或凭据。
