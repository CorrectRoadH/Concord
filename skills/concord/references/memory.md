# 工程 Memory

Memory 保存开发中可复用的经验：测量结论、根因、踩过的坑和做过的取舍。每条是 `memory/<id>.md` 一个文件，不复制 Spec 正文或测试关系。还要处理的问题写成 Issue，见 `concord --skill feedback`。过程日志、验收记录与修改记录不写进 Memory，历史由 Git 保存。

## 字段

路径是身份，名称是正文唯一的一级标题。frontmatter 只有一个可选字段：

```yaml
relations:
  - role: supports     # 它支持的 Feature、Use Case 或 Engineering 的路径或锚点
    target: docs/feature/login/README.md#token
```

Issue 指向 Memory 的关系写在 Issue 中，反向关系从中派生。

## 编辑与检索

直接创建、阅读、改写和删除 Memory 文件。经验过时就改写或删除，不保留状态或替代关系。

```sh
concord list memory --json
concord memory search "token 格式"
concord show token-format --json
concord memory link token-format docs/feature/login/README.md#token
```

`list` 与 `show` 从当前文件派生索引与反向关系，不手工维护 INDEX。`concord check` 校验关系目标。
