# 文档与标记格式

本页声明使用者直接编辑的文档路径、Issue 与 Memory 的 frontmatter，以及测试与源码中的 Concord 标记。命令与输出见[命令体验](cli.md)。

## 文档路径与 frontmatter {#owner}

文档的分组、位置、[身份](../../document-model.md#身份)与[页面种类](../../document-model.md#页面种类)由[文档模型](../../document-model.md)定义：canonical 仓库相对路径是唯一身份，同类别内可用[短选择器](concepts.md#short-selector)（歧义时具名拒绝，例如两个 Feature 都有 `use-case/create.md` 时 `show create` 要求写出路径），名称取自 Markdown 语法树中正文唯一的一级标题（代码块中的标题不计）。创建时间与修订历史由 Git 提供（[只写当前声明](../../document-model.md#只写当前声明)）。

普通正文链接只是导航。只有 Issue 与 Memory 使用 frontmatter，路径值一律是仓库相对路径，字段只在非空时出现（[一件事只写一次，其余推导](../../taste.md#t-3)）。

### Issue

```yaml
relations:
  - role: root-cause
    target: memory/token-race.md
source: {...}
```

| 角色 | 目标 | 含义 |
| --- | --- | --- |
| `investigation`、`root-cause` | Memory | 调查记录与根因 |
| `spec` | Feature、Use Case 或 Engineering 的路径或锚点 | 这个 Issue 涉及的 Spec：缺陷违反了它，缺口等它实现，或外部请求已写进它；不再涉及时删除这一项 |
| `related` | 另一个 Issue | 两个 Issue 相关，例如一个观察的缺陷由另一个 Issue 跟踪 |

缺陷只在 Issue 中跟踪。`source` 是远端来源的稳定身份，字段见[反馈来源](../feedback/architecture.md)。Issue 处理完就删除，见[本地 Issue](../feedback/use-case/manage-local-observations.md#close)与[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)。

### Memory

```yaml
relations:
  - role: supports
    target: docs/feature/login/README.md#token
```

- `supports` 指向一条当前 Spec 或其锚点。Memory 只保存可复用的经验，过时就改写或删除。

## 派生关系

`@feature` 或 `@use-case` 用 canonical 路径指向对应 Spec，`@issue` 可重复指向回归测试守护的 Issue。每个标记块恰有一个 Spec 目标，同一 Spec 可有多个测试。执行引用由文件路径与测试名称自动派生，测试名称只描述行为，不携带机器 ID；不提供人工分配 ID 或先分配再关联的步骤。Spec 不反写测试列表，trace 每次从 owner 和源码重新编译反向关系。Issue 与 Memory 的正向关系只保存一次，反向关系派生。

## 步骤语法

步骤是 Use Case 完整路径里可以被测试和实现指向的一步，例如：

```markdown
1. 点“加入购物车”。 {#add}
```

- 步骤是 Use Case 正文中 Markdown 根节点直接拥有的有序列表项，第一段末尾带至少一个空格及 `{#id}`。解析不依据章节名称或正文语义；没有该语法的列表项不是步骤。ordinal 是合格项在文档中的展示顺序，从 1 计数，不采用作者所写的列表数字。
- 作者只对完整路径的步骤使用该语法，起始状态、结果、验收与异常说明不得使用。合法位置上的该语法都按步骤解析，工具不发现误标；`use-case steps` 展示全部步骤供审阅。
- `{#id}` 出现在无序列表项、嵌套列表项、Feature 或附页中时，`check` 报告 `InvalidStepPosition`。代码 fence、行内代码与 HTML 中的 `{#id}` 不是步骤。
- ID 语法与文档名相同，按原始 Unicode 拼写精确匹配，不做大小写折叠、Unicode 归一化或 slug 转换，例如 `{#拒绝过期令牌}`、`{#reject-token}`。ID 与同文件标题 anchor 共用命名空间，与标题显式 ID、slug 或折叠连字符后的别名冲突时报告 `DuplicateAnchor`。
- `@use-case <path>#<anchor>` 继续接受任意已存在的标题 anchor。删除步骤 ID 后悬空引用报告 `AnchorNotFound`，由作者修改标记，工具不猜测重定向。
- 两条写作检查路径都剔除真实步骤末尾的 ID；步骤视图与相关性判定不写回 Spec 或源码。`check` 不要求每个根有序列表项都有 ID。

## 关联身份与观察

| 身份 | 形式 | owner |
| --- | --- | --- |
| 步骤 | `<use-case path>#<step-id>`，见[步骤语法](#步骤语法) | Use Case 正文 |
| 测试关联 | `concord.test-reference/v1`：文件加 `@name`，或文件加 Spec 目标与标记序号 | 测试源码标记 |
| 代码关联 | JS/TS 为 `concord.code-reference/v1` 派生引用；其它语言为 canonical 文件路径加文件内标记块序号 | 代码声明 |
| 原生选择 | adapter 观察到的原生 ID 集合 | 无，执行时观察 |

前三种身份不随缓存变化；原生选择只影响执行。带 `@name` 的标记改变 Spec 目标时测试关联 ID 不变。原生选择与 symbol locator 不进入关联身份；原生清单是否存在不改变 case 集合、case ID 或 `check` 的关系结论。原生标签（pytest mark、JUnit Tag 等）只作展示元数据，标签中的 Spec 字符串不创建关联，也不参与引用校验。

原生清单、依赖分析与相关性判定的输出见[观察与相关性](cli.md#观察与相关性)。

## 关联由源码声明拥有

测试与实现的关联由源码中的标记和代码声明拥有，指向最小完整范围（[一件事只写一次，其余推导](../../taste.md#t-3)）。

1. 测试根中的 Concord 标记是测试关联的唯一正向来源，标记存在即关联存在。静态关联扫描不解析宿主语言的测试声明、框架绑定、回调或 `skip`/`todo`。执行时的原生收集、绑定与选择仅按 [关联由源码声明拥有](#关联由源码声明拥有) 进行，其观察结果不创建关联，也不授权静态关系检查成功。
2. 实现关联的唯一正向来源是通过语法、作用域、位置与目标校验的显式代码声明。未通过校验的标记产生 finding，不建立关联。反向关系从测试标记与代码声明派生。
3. 测试与实现指向能完整、准确描述该测试断言或该声明职责的最小既有 Spec 范围。测试与实现都可以指向 Feature 或 Engineering 文档包、它们的 Use Case 与步骤，以及附页或标题 anchor。对使用者可观察的保证先写进行为页再关联。只服务内部不变量的代码与测试，指向所属 Feature 的 architecture 或 data-model 页的 anchor；仓库维护机制的代码与测试指向 Engineering，例如检查依赖规则的架构测试。跨步骤的完整断言指向整个 Use Case，一个声明服务多项行为时使用多个 implements。没有合法目标的测试不建立关联，不为此伪造产品步骤。

   测试标记的类别按目标类别匹配：`@feature docs/engineering/<t>/README.md` 指向 Engineering 文档包，`@use-case docs/engineering/<t>/use-case/<u>.md` 指向它的 Use Case。
4. 代码侧选择完整且受支持的语义范围。整个文件服务同一职责且没有更精确的适用目标时，使用文件级声明。不为追求更窄而拆分实现、复制测试或机械改名步骤。缺少逐步骤关联不说明缺少执行或覆盖。
5. JS/TS 仅用注释范围排除字符串和模板中的伪标记；其它文本文件接受以 `//`、`#` 或 `--` 开头的标记行。
6. 执行由接入项目的 runner 命令或显式配置的 adapter 负责。adapter 可以仅在显式收集或执行前，把源码标记绑定到观察到的原生用例集合，或使用源码标记中的显式原生选择参数。原生选择不参与关联身份，不产生关联，不使静态检查依赖观察。只有能力和当前输入足以证明精确选择时，才声明选中了原生用例；否则执行范围按文件明确展示，要求原生精确选择的操作具名失败。缺少逐用例选择能力不使源码关联失效。
