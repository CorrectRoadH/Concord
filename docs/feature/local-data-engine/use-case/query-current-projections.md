# 检索当前来源的派生投影

## 用户目标

维护者或 agent 在持续增长的 Memory 和 Issue 中查找经验与待办，希望重复搜索不反复读取全部正文，同时每次拿到的都是文件当前的内容：改过、删过或清空缓存之后，结果里不会混入旧的对象。

## 起始状态

- 项目已初始化，`memory/cache-lesson.md` 与 `docs/issues/slow-check.md` 已提交。
- 文件拥有身份、正文、关联与生命周期；缓存中的检索[投影](../../../concepts.md#projection)只是可重建的派生数据，不是第二个登记表。

## 完整路径

1. 检索 Memory 与 Issue。 {#search}

   ```sh
   concord memory search 缓存
   concord issue search 检查
   ```

   ```text
   memory search
   memory/cache-lesson.md — 删除缓存后检查结论不变
     # 删除缓存后检查结论不变 缓存只保存可以重建的派生数据。删除 `.git/concord/cache.hawdb` 后再次运行 `concord check`，结论与删除前相同，只是第一次稍慢。
   ```

   ```text
   issue search
   docs/issues/slow-check.md — 大仓库里检查变慢
     # 大仓库里检查变慢 在两千个文件的仓库里，第一次 `concord check` 用了 4 秒。
   ```

   以上是预期输出。结果保留 canonical path，并绑定当前来源的摘要。关键词规则见[关键词检索](../../local-sdlc/use-case/recall-and-maintain-memory.md#recall)。相同来源上的重复检索复用已核验内容；第一次构建、服务重启核验与缓存不可用时允许完整读取来源。

2. 改写 Memory 正文后再检索。 {#edit}

   把正文改成“缓存只保存派生数据。清空后第一次检查重建缓存。”，再运行：

   ```sh
   concord memory search 缓存
   concord memory search 稍慢
   ```

   ```text
   memory search
   memory/cache-lesson.md — 删除缓存后检查结论不变
     # 删除缓存后检查结论不变 缓存只保存派生数据。清空后第一次检查重建缓存。
   ```

   ```text
   memory search
   None.
   ```

   只在旧正文里出现的词不再命中。

3. 清空缓存后再检索。 {#rebuild}

   ```sh
   concord cache clear
   concord memory search 缓存
   ```

   结果与清空前等价。重建索引不修改文件，不触发远端同步、模型调用或证据生成。

## 结果

检索只经过 Concord 工具，不绕过来源的 Schema、路径、权限或当前摘要核验。

| 情形 | 看到什么 |
| --- | --- |
| 新增、修改或删除来源文件 | 结果只反映变化后的对象，不混入变化前的对象 |
| 文件移动、目录新增或切换分支 | 结果只反映当前来源，不遗漏新的命中 |
| 已开始搜索后，新增嵌套目录或原先不存在的 Memory / Issue 根目录 | 即使监听丢失，也检测变化并重试，不漏掉新命中 |
| 来源未变，重复搜索不同关键词 | 结果与直接匹配当前来源等价，不重复读取全部正文 |
| 一篇文件变化，随后检索 | 只需重新读取变化正文；查询仍核对整个目标集合的完整性 |
| 目标集合中有坏文档，即使它不会命中 | 返回该来源的具名错误，不返回部分搜索结果 |
| 查询期间来源持续变化，重试仍无法核验 | 返回 `SourceChanged`，不以陈旧结果冒充当前内容 |
| 空查询 | 具名拒绝：`InvalidInput`，消息 `recall/search query must be non-empty`，退出 1 |
| 缓存引擎不可用 | 具名失败，保留原始原因，不切换存储或扫描来源 |
| 引擎不可用时无法保持语义的增强检索 | 明确报告不可用，不伪装成功 |
| 清空缓存后重新检索 | 得到当前来源的等价结果，文件不变 |

检索返回全部命中，不能为满足内部查询上限而悄悄只返回前几条。显式内存模式不改变关键词、正文、摘要和排序；缓存故障直接报告，不产生替代结果。新增、修改与删除的验收同时覆盖外部编辑器写入及 Concord 自身写入；来源监听事件丢失时，下一次检索仍发现变化。

正文读取量、索引访问与查询耗时的验证边界见[性能测量](../performance.md#knowledge-search)。这些约束描述目标行为，不是测量结果。
