# 可扩展的页面种类

项目可以在 Feature、Engineering 与 Roadmap 文档包里放自己命名的页面，例如安全团队要求每个 Feature 有一页 `threat-model.md`，运维要求有一页 `runbook.md`。项目在配置里声明这些[自定义页面种类](../../concepts.md#custom-page-kind)，Concord 把它们当作合法页面识别、列出和检查拼写。

## 你可以做什么

- 在 `concord.config.ts` 的 `pageKinds` 里声明种类名、它回答的读者问题，以及它是行为页还是实现页。
- 在任意文档包里写 `<种类>.md`；一页写不下时，和内置种类一样换成 `<种类>/` 目录。
- `concord check` 不再把这些页面报成 `UnknownPageKind`；文件名拼错时，建议里包含自定义种类。
- `concord show` 的 `pages`、Web 工作台与 Concord mod 列出这些页面，和内置种类一起排列。

## 上手

```ts
export default {
  pageKinds: [
    { name: 'threat-model', question: '有哪些威胁、怎样应对', category: 'behavior' },
  ],
};
```

然后新建 `docs/feature/login/threat-model.md` 并运行：

```sh
concord check
```

页面被识别为 `threat-model` 种类，检查通过（以下为预期输出）：

```text
check: ok
```

## 怎样工作

内置种类由[文档模型](../../document-model.md#页面种类)固定，自定义种类只在声明它的项目里有效。识别顺序不变，自定义种类和内置的种类单页与种类目录处在同一层：文件名或种类目录名等于某个声明的 `name`，页面就属于该种类。

自定义种类的名称不能与内置种类、`show` 已用的种类值或文档包里的保留名相同，配置字段与校验见[项目配置文件](../project-onboarding/format.md#配置项)。Concord 不为自定义种类提供模板、专门的渲染或内容检查；写作检查、链接与锚点检查照常适用。

`question` 与 `category` 写给读者和 agent，说明这一页该写什么，不参与检查。`concord show` 的 `pages` 中这类页面的 `kind` 是种类名。

## 范围

- 包括：声明、识别、列出与拼写建议。
- 不包括：自定义种类的模板、Schema 或内容规则，以及改变内置种类的含义。需要专门渲染或检查的种类作为内置种类进入文档模型，例如 statechart。

## Use Case

- [声明项目自己的页面种类](use-case/declare-page-kind.md)
