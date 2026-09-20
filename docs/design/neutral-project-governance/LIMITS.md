# 约束

- 不以纯文档项目作为设计目标，不强迫消费者采用 Concord 开发栈。
- 保留已有 Web 未提交编辑；不发布、push、远端 mutation 或付费调用。
- 不把 command evidence 当作 native/reliability 证明；旧原件不能通过改字段重签。
- 源码/helper、契约、policy、配置和 adapter 身份必须绑定。red 允许使用不同的缺陷候选，green/reliability 必须使用同一修复候选。
- 跨入口 fixed 使用共同最低要求；迁移共同保护旧、新锁和未完成事务。
