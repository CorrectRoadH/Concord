# 声明项目自己的页面种类

## 用户目标

维护者想让每个涉及登录或权限的 Feature 都有一页威胁模型，文件名统一叫 `threat-model.md`，并希望 `concord check` 接受它、在文件名拼错时提醒。

## 起始状态

- 仓库已初始化，有 Feature `login`，`concord.config.ts` 没有 `pageKinds`。
- `docs/feature/login/threat-model.md` 已存在，`concord check` 对它报告 `UnknownPageKind`。

## 完整路径

1. 在 `concord.config.ts` 中声明种类。 {#declare}

   ```ts
   export default {
     pageKinds: [
       { name: 'threat-model', question: '有哪些威胁、怎样应对', category: 'behavior' },
     ],
   };
   ```

2. 运行 `concord check`。 {#check}

   `UnknownPageKind` 消失，检查通过。`concord show login` 的 `pages` 列出 `docs/feature/login/threat-model.md`，`kind` 为 `threat-model`。

3. 在另一个 Feature 新建 `threat-modle.md` 并运行 `concord check`。 {#typo}

   检查报告 `UnknownPageKind`，`details.suggestions` 给出 `threat-model`。维护者把文件改名后检查通过。

4. 在 Concord mod 或 Web 工作台打开 Feature `login`。 {#browse}

   文档列表在 `login` 下列出这页，与 architecture、cli 等页面并列，使用普通页面图标。

## 结果

项目自己的页面和内置种类一样被识别、列出并检查拼写；Concord 不为它提供模板或内容规则。

| 情况 | 结果 |
| --- | --- |
| `name` 与内置种类或保留名相同，例如 `architecture`、`README` | 配置解码失败，`InvalidData` 指出冲突的名称 |
| `name` 不是小写字母、数字与连字符组成的 1 到 64 个字符，或重复声明 | `InvalidData` |
| 删除声明后仍有该种类的页面 | 这些页面重新报告 `UnknownPageKind` |
| 同一种类的单页与目录并存，例如 `runbook.md` 与 `runbook/README.md` | 单页报告 `UnknownPageKind`，与内置种类相同 |
