# 规划并采用文档 Spec

## 用户目标

功能负责人用 Feature、Use Case、Roadmap、Design 与 Engineering 分别写当前能力、用户路径、待采用的方向、方案比较和仓库维护机制。全部文件直接编辑；方向准备实现时，把 Roadmap 整体采用为 Feature，不手工移动文件与改写链接。

## 起始状态

- 项目已经初始化。

## 完整路径

本页示例为预期输出。

1. 创建 Feature 与 Use Case。 {#create}

   ```sh
   concord new feature cart --title "购物车" --pages cli,use-case
   concord new use-case add-item --feature cart --title "加入商品"
   ```

   ```text
   Applied new:
     docs/feature/cart/README.md
     docs/feature/cart/cli.md
     docs/feature/cart/use-case/README.md
   ```

   README 必需，`--pages` 从[页面种类](../../../document-model.md#页面种类)中选择其余页面，省略时只建 README；可选值与错误见[创建与编辑文档](../cli.md#创建与编辑文档)。`--title` 写成一级标题，省略时取名称。Design 是单个文件 `docs/design/<名称>.md`。

   Engineering 与 Roadmap 使用同样的页面种类与 `--pages`，例如 `concord new engineering testing --pages cli,architecture`。

   也可以直接创建目录与 README，结果相同：类别由路径决定，名称由一级标题决定。

2. 编辑页面。 {#edit-page}

   直接编辑 `docs/` 下的任何 Markdown 页面。新增页面时使用对应种类的文件名，例如在文档包目录中新建 `ui.md`；一种页面写不下时，把 `<种类>.md` 换成 `<种类>/` 目录，入口为 `<种类>/README.md`，其余页面自由命名。Spec 没有 frontmatter。编辑后运行 `concord check`，种类以外的页面报告 `UnknownPageKind`。

3. 把尚未采用的方向写成 Roadmap。 {#roadmap}

   ```sh
   concord --json new roadmap checkout --title "结账" --pages use-case
   ```

   ```json
   {"operation":"new","dryRun":false,"changedPaths":["docs/roadmap/checkout/README.md","docs/roadmap/checkout/use-case/README.md"]}
   ```

   Roadmap 的示例都是预期输出，实现与测试不指向 Roadmap（[页面职责](../../../document-model.md#页面职责)）。

4. 准备实现时，把 Roadmap 移入 Feature。 {#adopt}

   ```sh
   concord --json roadmap start checkout
   ```

   ```json
   {"operation":"roadmap-start","dryRun":false,"changedPaths":["docs/roadmap/checkout/README.md","docs/roadmap/checkout/use-case/README.md","docs/feature/checkout/README.md","docs/feature/checkout/use-case/README.md"]}
   ```

   省略 `--feature` 时，Feature ID 与 Roadmap 同名；用 `--feature <id>` 换一个 ID，例如 `concord roadmap start checkout --feature cart-checkout`。

## 结果

采用把 `docs/roadmap/checkout/` 整个目录移为 `docs/feature/checkout/`，新 Feature 成为当前 Spec。目录内的相对链接保持指向移动后的页面，目录外的链接保持原目标，仓库中指向原路径的链接与关系改指新路径。采用历史由 Git 保存。

以下情况拒绝，不留下部分写入：目标目录已存在、嵌套 owner、非 Markdown 附件、symlink、无法安全改写的链接，以及采用过程中源文件被修改。直接移动目录时，`check` 报告断开的链接。

Design 只允许一次裁决，裁决方式见[逐项比较方案并明确裁决](compare-design-plans.md)。

## 路径与身份

- 路径、类别与短选择器的规则见[文档与标记格式](../format.md#owner)。
- Feature、Roadmap 与 Engineering 位于各自分类下的单层目录，入口是 `README.md`；Design 是 `docs/design/` 下的单个文件。Use Case 位于所属文档包的 `use-case/` 目录，一个文件是一个旅程，不嵌套；`use-case/README.md` 是导航页。Issue 是 `docs/issues/` 下的 `.md` 文件，Memory 是 `memory/` 下的 `.md` 文件。
- 文档包内其它页面按[路径与识别](../../../document-model.md#路径与识别)归入页面种类。种类目录不产生新的 Feature 或 Engineering，其中的页面仍以精确路径引用。命令不会自动把一页拆成种类目录，也不会自动移动无法归类的页面。
- 采用、关系与修复核验都使用实际路径，发布和恢复不会按名称重新猜路径（[文档身份](../architecture.md#文档身份)）。
- 包内页面可以按精确路径或 anchor 归到所属 Feature，相邻目录不会因目录名前缀相似而混入。

## 名称

文档包目录名、Use Case 文件名、Design 候选名和种类目录内的页面名支持 Unicode 字母、组合标记和数字，可以用单个连字符分隔。种类单页与种类目录使用固定的英文种类名。

```sh
concord new use-case 扩展NPC动作 --feature npc --title "扩展 NPC 动作"
```

命令生成 `docs/feature/npc/use-case/扩展NPC动作.md`。路径名保留原样，不翻译，不改大小写，也不做 Unicode 规范化。不允许空白、控制字符、路径分隔符、点段和引用分隔符。CLI、页面编辑与 Web 使用同一套校验，`check` 对直接创建的文件执行同一校验。

## Spec 来源

- 页面写法：`concord --skill document`
- 命令总览：[CLI](../cli.md#创建与编辑文档)
