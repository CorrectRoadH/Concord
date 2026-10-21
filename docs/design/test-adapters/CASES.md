# 多框架测试 adapter

| 场景 | 输入与操作 | 验收结果 |
| --- | --- | --- |
| C1 | 真实 pytest provider 返回装饰器与函数完整范围、参数组 | 一个标记绑定整个展开组；缺少范围则要求显式 selector 或声明文件级 |
| C2 | 精确选择两项 | 实际消费者观察到仅这两项执行；父 suite 初始化单独记录，不能冒充额外 leaf |
| C3 | 组中部分缺失、skip、todo、not-run、重复或额外 ID | 原生结论 invalid，不能 fixed |
| C4 | 全部 passed 且退出 0、报告完整、清理完成 | 非空 requested 才可 green |
| C5 | 每项恰好一次、有 failed、退出非零、清理完成 | red；fixture、parser、infra 失败为 invalid |
| C6 | Go 顶层与动态子测试 | list 只作顶层发现；动态子项需要真实运行观察；使用 -count=1，不冒充本次执行 |
| C7 | tag-only 错误契约与有源码错误标记 | 标签不产生关系；源码错误在所有缓存状态均被发现 |
| C8 | 标记处于父 suite 与子 leaf 之间、重复全名或组范围重叠 | 按范围与组规则唯一绑定；歧义为执行失败，不改变 check |
| C9 | 同源码 cold、warm、缓存损坏与清空 | 静态关系、ID、check complete 与退出码相同 |
| C10 | 收集中修改 fixture、配置、lockfile，或增加测试成员 | 结束核验拒绝发布当前清单；旧观察仅历史展示 |
| C11 | node adapter.js 的脚本变化但 node 不变 | 实现摘要变化，旧观察不能用于当前选择 |
| C12 | 超时后进程残留、取消、输出截断 | invalid；清理未知阻断发布，不把 JSON 成功作为进程成功 |
| C13 | 参数组跨 Cargo binary 或测试项目 | Invocation[] 明确拆分；ID 含 package/target/binary，不重复执行共享 leaf |
| C14 | symlink、特殊报告文件、目录逃逸、旧报告或超预算 | 具名拒绝，不能解析为有效收据 |
| C15 | 命名测试改目标或 native selector 变化 | v1 关联 ID 不因 native 改变；定义或契约摘要使旧证据失效 |
| C16 | 重试同一项、JUnit 名称碰撞、只有退出码 | 不能压缩成单次 passed；当前能力不足返回 invalid 或命令级证明 |
| C17 | 无 adapter 或未绑定 | 保持文件级 command scope；要求原生精确选择时失败 |
| C18 | 构建打包 CLI 与固定版本真实框架隔离消费 | 验证真实选择、报告和进程终结；只对外部程序边界做 fake |
