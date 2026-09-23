# 适配器接口

`feedback-schema.ts` 拥有浏览器与服务端共享的连接、来源与远端观察 Schema。`feedback-providers.ts` 负责 GitHub / Linear 协议、身份解析、范围校验和有界分页。`feedback.ts` 负责本地观察与幂等导入，`feedback-cache.ts` 负责可重建远端投影。

适配器的 `fetchFeedback(connection, options)` 返回 Effect，结果包含绑定后的连接、规范化条目及读取时间。可注入 transport 以模拟 HTTP 边界；该接口不会赋予 provider 修改项目文档的权限，也不持有仓库写锁。

连接 Schema 区分 API 与 GitHub gh：API 分支的 `transport` 缺省或为 `api`，必须包含 `credentialEnv`；gh 分支必须显式指定 `transport: gh`，并拒绝 `credentialEnv`。transport 不进入远端对象去重键，适配器返回值不能自行修改连接的读取方式或目标范围。

显式 action `feedback.check` 接受已保存的连接 ID，仅支持 gh 连接；返回 `connectionId`、`provider: github`、`transport: gh`、`target` 与 `checkedAt`。检测不返回密钥、原始命令输出或账号清单，不发布远端绑定或缓存。Web 先完成当前设置草稿保存，再调用检测；旧结果不能回写新配置。

CLI 进程入口受 Scope 和服务进程的单槽约束，取消与关闭必须等待确定的清理结果。测试可替换外部进程边界，但不得替换 Concord 的资源所有权、响应规范化或本地发布来声称生命周期验收通过。详细预算及模式保证见[接入设计](cli-integration.md)。

调用方只有在整个遍历成功后才能发布结果，不能把分页器返回的一部分条目当作完整同步。新增 provider 需给出稳定身份、范围绑定、凭据类型、限流与错误语义，并通过同样的幂等、失败与缓存验收。

协议依据：[GitHub REST issues](https://docs.github.com/en/rest/issues/issues)、[Linear GraphQL](https://linear.app/developers/graphql)、[Linear pagination](https://linear.app/developers/pagination) 与 [Linear rate limits](https://linear.app/developers/rate-limiting)。
