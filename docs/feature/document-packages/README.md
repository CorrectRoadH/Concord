# 文档目录与完整发现

维护者把 Spec 写成 `docs/` 下的普通文件，Concord 从目录里找出全部文档：Feature、Engineering、Roadmap、Design 与 Issue。不需要登记，放对位置、写好一级标题，文档就出现在 CLI 和 Web 中。

## 你可以做什么

- 新建目录或文件即新增文档。身份由路径决定，名称取自正文唯一的一级标题（[文档与标记格式](../local-sdlc/format.md#owner)）。
- 用中文等 Unicode 名称命名 Feature 目录、Use Case 文件和种类目录内的页面，不需要另建英文副本。
- 在 CLI 与 Web 中看到同一份文档清单：两者使用同一套发现规则。
- 编辑文档的同时运行检查：检查期间文件被改动时，Concord 自动重试，不把半途的状态报告为结论。

## 上手

以下在一个已有几篇文档的仓库中实际运行。新建一个中文名的 Feature 和它的 Use Case：

```text
docs/feature/购物车/README.md            # 一级标题：# 购物车
docs/feature/购物车/use-case/修改数量.md  # 一级标题：# 修改数量
```

列出全部文档：

```sh
concord list
```

```text
list
documents:
  docs/feature/cart/README.md — cart (feature)
  docs/feature/购物车/README.md — 购物车 (feature)
  docs/feature/购物车/use-case/修改数量.md — 修改数量 (use-case)
  docs/issues/slow-check.md — 大仓库里检查变慢 (issue)
  memory/cache-lesson.md — 删除缓存后检查结论不变 (memory)
```

打开这个 Feature，看到它的页面与 Use Case（节选）：

```sh
concord show 购物车
```

```text
Pages:
  docs/feature/购物车/README.md [readme] 购物车
  docs/feature/购物车/use-case/修改数量.md [use-case] 修改数量
…
useCases:
  docs/feature/购物车/use-case/修改数量.md — 修改数量 (use-case)
```

## 怎样工作

Feature、Engineering 与 Roadmap 是目录，由目录和其中 `README.md` 的一级标题确定；Design 与 Issue 各是单个文件。文档包内其它页面使用固定的[页面种类](../../document-model.md#页面种类)文件名；项目的说明性文档放在包外，用链接连到 Spec。

发现只读不写：无法读取的文档产生带路径的 [finding](../../concepts.md#finding)，结果标为不完整，原文件保持不动。目录归属与编辑期间重试的实现见[架构](architecture.md)。

## 用户路径

- [完整发现受管文档](use-case/discover-managed-documents.md)

## 范围与验收

发现覆盖当前格式的全部受管文档；验收要观察的情形见[完整发现受管文档](use-case/discover-managed-documents.md#结果)。结构检查不产生测试执行证据（[只声称证明过的](../../taste.md#t-5)）。

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
