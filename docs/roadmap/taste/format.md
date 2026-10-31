# 品味文件的格式

品味文件是 `docs/taste.md`，可以直接编辑。文件只保存当前正文，修改历史从 Decision Memory 与 Git 推导。

## 结构

```markdown
# Concord 的品味

## 总则 {#general}

1. 品味是判断标准；底线违反即阻止交付。 {#general-use}

## T-1 读得懂胜过写得全 {#t-1}

Spec 没人看得懂，就没人认真审阅，也就没人维护。

- 好的样子：……
- 坏的样子：……

## B-1 凭据不进入日志 {#b-1}

1. 凭据只从环境变量读取，不得写入文档、日志或诊断。 {#b-1-1}
```

- 品味的标题形如 `## T-1 标题 {#t-1}`，标签与 ID 的数字一致。正文写它解决的问题和好坏对照，不分款。
- 底线的标题形如 `## B-1 标题 {#b-1}`。每款是根有序列表项，第一段末尾写 `{#b-1-1}`；款 ID 是条目 ID 加连字符，再加一段小写字母、数字与单连字符。
- 总则写 `## 总则 {#general}`，其款写 `{#general-<name>}`。
- 每个条目与每款都有 ID，全文唯一；ID 一经使用不改名、不复用，新条目取未使用的编号。
- frontmatter、代码、HTML 与注释中的 `{#...}` 不产生 ID。没有显式 ID 的标题不能作为链接目标。

文件没有 frontmatter，也没有草稿与生效两种状态：文件存在，其中的条目就生效。

## 链接

`docs/` 下除 `docs/_template/` 与品味文件本身外的 Markdown 正文都可以链接条目，只计入行内链接。链接相对所在文件解析，结果为 `docs/taste.md` 才是品味链接；不读取网络，不跟随 symlink。不带 fragment 的链接不建立关系。指向款的链接同时归属其条目。

Design 与 Research 是记录，按写下时的含义理解：其中指向已不存在的条目的链接不报告。

## 修改记录

每次修改条目，在同一变化中附一条 Decision Memory，写明适用范围、理由、来源与影响，以 `changes` 关系指向被修改的条目或款：

```markdown
---
type: decision
status: current
relations:
  - role: changes
    target: docs/taste.md#t-1
---

# T-1 增加 Use Case 的好坏对照

## 适用范围
……
```

第一次写下条目时，这条 Memory 以 `changes` 指向整个 `docs/taste.md`。`changes` 指向已不存在的条目时照常有效，它记录的是当时的修改。
