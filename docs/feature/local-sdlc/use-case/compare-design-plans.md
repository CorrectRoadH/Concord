# 记下一个还没定的取舍

## 用户目标

维护者遇到一个真正难以取舍的问题，例如一个 API 有几种可行的形状，想先把几种做法和各自的代价摆在一起讨论；定下来以后，规则写进 Spec，讨论稿不再留在仓库里。

## 起始状态

- 项目已初始化。
- Feature `session` 要决定会话数据存在哪里，还没有定论。

## 完整路径

1. 新建一页 Design。 {#create}

   ```sh
   concord new design session-store
   ```

   这会创建 `docs/design/session-store.md`，也可以直接创建这个文件。

2. 写下要决定什么、几种做法和各自的代价。 {#write-options}

   ```markdown
   # 会话数据存在哪里

   要决定：登录后的会话数据放在哪里，重启后是否保留。

   ## 做法一：内存

   - 好处：最简单，没有额外依赖。
   - 代价：重启后所有人要重新登录。

   ## 做法二：SQLite 文件

   - 好处：重启后保留，仍然不需要服务。
   - 代价：需要处理多进程同时写入。
   ```

   页面只写还没定的部分；已经确定的约束直接链接所属的 Spec。

3. 定下来以后，把规则写进 Spec，删除这一页。 {#decide}

   例如在 Feature `session` 的 architecture 页写下“会话数据存放在 `.session/store.sqlite`，重启后保留”，然后删除 `docs/design/session-store.md`，在提交说明里写选了哪种做法、为什么。

## 结果

`docs/design/` 里只剩还没定的取舍。定下来的规则在 Spec 里，讨论过程和理由在 Git 历史与提交说明里。

| 情形 | 结果 |
| --- | --- |
| 删除 Design 时仍有页面链接它 | `check` 报告断开的链接；把这些链接改为指向承接规则的 Spec |
| 问题其实不难取舍 | 不写 Design，直接改 Spec |

## Spec 来源

- [文档模型](../../../document-model.md#design)
