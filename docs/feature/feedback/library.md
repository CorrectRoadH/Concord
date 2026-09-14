# 适配器接口

`feedback-schema.ts` 拥有浏览器与服务端共享的连接、来源与远端观察 Schema。`feedback-providers.ts` 负责 GitHub / Linear 协议、身份解析、范围校验和有界分页。`feedback.ts` 负责本地观察与幂等导入，`feedback-cache.ts` 负责可重建远端投影。

适配器的 `fetchFeedback(connection, options)` 返回 Effect，结果包含绑定后的连接、规范化条目及读取时间。可注入 transport 以模拟 HTTP 边界；该接口不会赋予 provider 修改项目文档的权限，也不持有仓库写锁。

调用方只有在整个遍历成功后才能发布结果，不能把分页器返回的一部分条目当作完整同步。新增 provider 需给出稳定身份、范围绑定、凭据类型、限流与错误语义，并通过同样的幂等、失败与缓存验收。

协议依据：[GitHub REST issues](https://docs.github.com/en/rest/issues/issues)、[Linear GraphQL](https://linear.app/developers/graphql)、[Linear pagination](https://linear.app/developers/pagination) 与 [Linear rate limits](https://linear.app/developers/rate-limiting)。
