# 检索当前来源的派生投影

## 用户目标

维护者或 agent 检索 Memory 和 Issue，想确认每次拿到的都是文件当前的内容：改过、删过或清空缓存之后，结果里不会混入旧的对象。

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

   结果保留 canonical path，并绑定当前来源的摘要。

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
| 文件跨 Memory source 移动，或局部 scope 变化 | 同上，结果只反映当前来源 |
| 空查询 | 具名拒绝：`InvalidInput`，消息 `recall/search query must be non-empty`，退出 1 |
| 缓存引擎不可用 | 基础本地读取回源，结果仍是当前内容 |
| 引擎不可用时无法保持语义的增强检索 | 明确报告不可用，不伪装成功 |
| 清空缓存后重新检索 | 得到当前来源的等价结果，文件不变 |
