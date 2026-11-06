# 将外部反馈关联到项目调查与功能

## 用户目标

维护者想把 GitHub 或 Linear 上的 issue 拿进项目，在本地写调查笔记，关联 Memory 与它涉及的 Spec，处理完留下关闭结论，同时不改动远端。

## 起始状态

- 项目已初始化，可以在 CLI 或 Web 工作台中操作。
- API 读取方式需要凭据环境变量，例如 `GITHUB_TOKEN` 或 `LINEAR_API_KEY`；gh 读取方式需要运行 Concord 的机器上已完成 `gh auth login`。

## 完整路径 {#主流程}

1. 保存连接。 {#connect}

   ```sh
   concord feedback connection add --id product-github --provider github \
     --owner example --repo product --credential-env GITHUB_TOKEN
   ```

   ```text
   Applied set-config:
     concord.config.ts

   Next: concord check.
   ```

   连接保存连接 ID、来源范围与读取方式，省略读取方式时使用 API。API 连接只保存凭据环境变量名；gh 连接（`--transport gh`）复用服务端机器的 CLI 登录态，不保存凭据变量或密钥。Web 在「项目设置 → 反馈来源」完成同样的保存。

2. 检测 gh 连接（可选）。 {#check}

   ```sh
   concord feedback connection check product-gh --json
   ```

   检测只在明确触发时启动 gh，不导入反馈，也不绑定远端范围。Web 的「检测连接」先保存当前设置，保存冲突时保留草稿并停止检测。

3. 导入一个 issue，或同步整个范围。 {#sync}

   ```sh
   concord feedback import https://github.com/example/product/issues/123 --connection product-github
   concord feedback sync --connection product-github
   ```

   预期输出（同步）：

   ```text
   Applied feedback-sync:
     concord.config.ts
     docs/issues/feedback-github-2448391001.md

   Fetched: 1; imported: 1.

   Next: concord check.
   ```

   读取不持有发布租约。分页只是一次有界遍历，不承诺某一瞬间的完整快照。首次完整同步成功时持久绑定远端范围身份；连接检测不绑定。同一来源对象只有一条本地反馈，换连接或清空缓存后再次导入也不重复创建。

4. 阅读反馈。 {#browse}

   ```sh
   concord feedback list --provider github --triage pending
   concord feedback show feedback-github-2448391001 --json
   ```

   详情分别展示首次来源摘录、缓存的远端观察和本地 Markdown 笔记。更新远端数据不改本地标题、正文或关闭状态。

   Web 以常驻内容导航作为选择入口，搜索、来源与处理状态筛选紧邻条目列表。点击条目后列表仍保留，右侧显示该反馈的正文、来源与关联及生命周期，不要求返回列表才能选择另一条。

   移动端使用共享内容导航抽屉，选择后关闭抽屉。切换反馈继续遵守正文保存和冲突保护。选择反馈不读取远端。

5. 关联调查与涉及的 Spec。 {#link}

   ```sh
   concord issue link feedback-github-2448391001 --role investigation memory/example.md
   concord issue link feedback-github-2448391001 --role spec docs/feature/example/README.md
   ```

   按角色关联 Memory，或以 `spec` 指向它涉及的 Feature、Use Case 或 Engineering，角色见 [Issue 字段](../architecture.md#issue-字段)。

6. 处理完，关闭本地 Issue。 {#close-local}

   ```sh
   concord issue close feedback-github-2448391001 --reason "调查结论"
   ```

   关闭按[关闭本地 Issue](manage-local-observations.md#close)删除本地文件，不关闭远端 issue。

## 结果

反馈的去重身份与来源绑定稳定；任何失败都不发布部分反馈，也不改动远端。

### 验收

| 情形 | 看到什么 |
| --- | --- |
| 判断两条反馈是否同一来源对象 | GitHub 使用 REST issue ID，Linear 使用组织与 issue UUID；名称、显示编号、标题和连接 ID 都不是去重身份 |
| 同步 GitHub 范围 | 列出所有状态的 issue，排除 PR |
| 同步 Linear 范围 | 包含归档项 |
| 任一页读取失败、GraphQL errors 或超出遍历上限 | 不发布部分反馈 |
| 连接范围变化，或读取期间项目配置变化 | 明确失败，保留原文档 |
| `--dry-run` | 不写文档和缓存 |
| 缓存被清空或损坏 | 持久来源、本地笔记与关系仍可读 |
| Web 读取来源正文时缓存正被写入 | 500ms 内异步重试；等待前释放读取句柄与来源快照 |
| Web 读取来源正文时缓存持续占用或损坏 | 保留不可用提醒、本地笔记与首次导入快照，不读取远端 |
| 远端观察比缓存中的旧 | 不以较旧的 `updatedAt` 覆盖较新的观察 |
| 相同版本但内容不一致 | 保留旧值并报告冲突 |
| 在 Web 或 CLI 中创建本地反馈、配置连接、导入、同步、关联和关闭 | 两个入口都支持；Web 普通刷新不请求外部服务 |
| Web 反馈列表 | 保留来源与处理状态筛选，低频来源字段在详情中展开 |
| Web 详情的「来源与关联」页签 | 展示首次来源快照、上次观察缓存和 `spec` 关系；正文只编辑本地笔记 |
| 切换到来源页签 | 先完成草稿保存，冲突时保留草稿 |
| Memory 关系与关闭 | 在生命周期页签维护 |
| 添加、移除和配置连接 | 入口在项目设置；反馈页提供设置链接，以及已配置来源的同步与导入入口 |
| 没有远端来源 | 仍可创建本地反馈 |
| 反馈集合为空 | 不显示无作用的筛选 |
| 筛选无结果 | 保留筛选条件 |
| 无反馈、筛选无结果、反馈不存在 | 分别呈现 |
| 通过 URL 打开项目设置的来源视图 | 与配置表单及高级表示共用同一配置摘要和草稿保护；修改其它设置不覆盖并发新增或删除的来源 |
| gh 连接的页面刷新与配置保存 | 不启动 gh，不读取远端；只在显式检测、同步或导入时启动 |
| 检测前保存配置冲突 | 阻止检测 |
| 检测期间移除或切换连接 | 旧请求的结果不覆盖当前状态 |
| 在 API 与 gh 之间切换 | 保留绑定和去重身份，不自动回退，不重建反馈 |
| CLI 同步与检测同时请求 | 共用单个进程槽位 |
| 响应未完成时断开连接 | 取消读取 |
| 服务关闭 | 等待进程收尾或已开始的发布事务 |
| 读取失败、预算超限、取消或清理未确认 | 不发布部分反馈；清理状态未知时禁止继续启动 CLI 读取 |
| 密钥值 | 不进入项目文档、浏览器响应或诊断 |
| 来源设置、导入与同步 | 都须用户明确触发 |

验收测试只模拟外部 HTTP 或进程边界，不调用真实账号；Concord 的身份验证、资源回收和发布流程实际执行。
