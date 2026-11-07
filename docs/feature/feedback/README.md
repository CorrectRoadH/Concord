# 多来源反馈与本地处理

维护者和 AI 把本地观察、GitHub issue 与 Linear issue 汇入同一个反馈入口，在项目里写调查笔记，用带角色的[关系](../../concepts.md#relation)关联工程 Memory 与它涉及的 Spec，处理完留下关闭结论。

每条反馈都是一个本地 Issue 文件。远端来源由可扩展的读取适配器提供，只读不写；产品行为仍由 Feature 声明，反馈不是另一套需求登记表。修复核验的结论写在 Issue 的关闭结论中。

## 你可以做什么

- 不配置任何外部服务，直接记录、检索、关联和关闭本地 Issue。
- 连接 GitHub 仓库或 Linear team，导入一个 issue URL 或同步整个连接范围，与本地 Issue 放在同一个列表里。
- 按来源（`local`、`github`、`linear`）、处理状态（待处理、已关联）和关键词筛选反馈。
- 在 CLI 中得到结构化结果，适合 AI 按需读取和处理；在 Web 工作台中用同样的领域操作浏览和编辑。

## 上手

以下在一个已初始化、含 `memory/cache-lesson.md` 的仓库中实际运行。记下一个问题，正文直接编辑 `docs/issues/slow-check.md`：

```sh
concord new issue slow-check
concord feedback list --provider local --triage pending
```

```text
feedback list
feedback:
  document:
    path: docs/issues/slow-check.md
    metadata:
      …
      title: 大仓库里检查变慢
      kind: issue
      relations: none
    …
  provider: local
  triage: pending
  remote: none
  availability: local
  warnings: none
```

把调查结论关联上，状态变为已关联：

```sh
concord issue link slow-check --role investigation memory/cache-lesson.md
concord feedback list
```

```text
Applied link-issue:
  docs/issues/slow-check.md

Next: concord check.
```

```text
…
      relations:
        role: investigation
        target: memory/cache-lesson.md
    …
  provider: local
  triage: linked
```

处理完，关闭它：

```sh
concord issue close slow-check --reason "首次检查建立缓存，之后命中"
```

```text
Closed docs/issues/slow-check.md
Reason: 首次检查建立缓存，之后命中

Put the lines above in your commit message.
```

接入 GitHub 时先保存连接，再显式同步（同步一步为预期输出，需要 `GITHUB_TOKEN` 与网络）：

```sh
concord feedback connection add --id product-github --provider github \
  --owner example --repo product --credential-env GITHUB_TOKEN
concord feedback sync --connection product-github
```

```text
Applied set-config:
  concord.config.ts

Next: concord check.
```

```text
Applied feedback-sync:
  concord.config.ts
  docs/issues/feedback-github-2448391001.md

Fetched: 1; imported: 1.

Next: concord check.
```

## 怎样工作

本地 Issue `docs/issues/<id>.md` 是反馈唯一的 owner。导入的 Issue 在 frontmatter 的 `source` 中保存首次来源摘录，最近一次远端观察存放在可删除的本地缓存里；删除缓存不影响本地笔记与关系。字段与存储见[身份、存储与接入边界](architecture.md)。

连接检测与同步只在明确触发时进行，不轮询远端。反馈读取不修改远端 issue，远端写入只经 [`concord issue remote preview` 与 `remote apply`](../neutral-project-governance/use-case/mutate-remote-issue.md)。

Web 从侧栏「反馈」进入：左侧是常驻的反馈列表与筛选，右侧显示所选反馈的详情；手机通过共享内容导航抽屉选择反馈。导入与同步在反馈页操作，连接的维护在项目设置中。

## 用户路径

- [无外部服务时管理本地 Issue](use-case/manage-local-observations.md)
- [将外部反馈关联到项目调查与功能](use-case/triage-feedback.md)

## 范围与验收

- 支持 GitHub 公共 API 实例与 Linear 公共 API，默认用环境变量提供读取凭据。
- GitHub 还可在项目设置中显式选择 gh，复用运行 Concord 的机器上的 GitHub CLI 登录态，项目中无需配置凭据；要求 gh 2.98.0 或更新版本及 POSIX 进程组能力。两种读取方式的保证见[读取方式与保证](cli.md#读取方式与保证)。
- 不实现 webhook 接收和 OAuth 授权流程。
- 验收要观察的情形见各 Use Case 的结果。

## 细节

- [CLI 与 Web 用法](cli.md)
- [身份、存储与接入边界](architecture.md)
- [来源与工程知识术语](concepts.md)
- [性能预算](performance.md)

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
