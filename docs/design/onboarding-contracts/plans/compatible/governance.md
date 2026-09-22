> 历史方案记录：运行时兼容部分已被 [TS-only 裁决](../../../ts-only-runtime/README.md) 替代，不代表当前支持。

# 宪法格式与挑战条件

## 宪法单一格式

docs/constitution.md 是 Markdown 文件，使用严格 YAML frontmatter：format 为 concord.constitution/v1，status 为 draft 或 active，version 为三段非负整数版本字符串，ratifiedAt 为 ISO 日期或 null，amendedAt 为 ISO 日期，amendments 为追加记录数组。记录含 version、date、reason、sources（仓库相对引用数组）和 impact（非空作者说明）。这些字段仅在 frontmatter 存储，不在正文维护第二份。

默认初始化为 draft、0.1.0、ratifiedAt:null、amendments:[]，正文明确尚未采用项目原则。提供正文不会自动 active；显式采用必须提供真实条款、理由与影响，首次采用设置 ratifiedAt，后续保持。修订由具名操作整文件 CAS，保持历史前缀并更新 amendedAt；普通正文编辑不能悄悄改状态或历史。结构合法不等于治理通过。

后续裁决（2026-09-22）：宪法条款身份由路径和 anchor 拥有，整文件 digest 提供并发前像，因此不再要求语义版本号。此段保留原设计记录；现行契约见 Feature 的 evolve-constitution Use Case。旧版本字段只作为读取兼容输入；授权修订会投影为无版本历史，保留每条记录的日期、顺序、理由、来源和影响。旧程序无法读取新格式，回退程序前须恢复相应宪法文件。

条款声明是独占一行的 `<a id="c-001"></a>`，ID 是小写安全 slug，文档内唯一。解析忽略围栏代码、行内代码和 HTML 注释中的示例。constitutionRefs 仅接受 docs/constitution.md#<id>，只在 Feature/Design 声明；创建和作者字段编辑必须可用，反向关系派生。宪法不是测试 contract/code implements 的目标。

## 初始化与恢复条件

init 的 projectId、配置路径和 Memory 范围取自最终计划配置快照；目录只能是计划文件必要祖先。Memory 来源不能与固定 docs 根、其他来源、源码测试根、Git-private 范围重叠。发布与恢复均检查 canonical 路径、symlink 及完整前像集合。旧 journal 只采用独立保留的旧白名单。

协调层集成约束：只有尚未初始化、无受管 owner 且不存在任何锁文件的新仓库，init 预览才可不建立写 lease；已有 Concord 配置或 owner 的预览必须经过共享 lease，并同时尊重通用与 repository profile 两套 journal 障碍。确认发布后取得完整独占锁并重新验收全部前像。主线集成已验证该约束，不得以 `create=false` 绕过首次协调锁。确认期间变化的创建或保留文件必须触发 PreimageChanged；预览共享锁先释放，再获取独占锁校验完整前像。

## 必需的组合验收定义

1. TS 类型语法可读；运行时代码拒绝且无副作用；配置前像变化拒绝覆盖。
2. init 配置未发布和已发布、config.set before/after 的中断恢复；恢复再次中断可重试；双配置保留现场。
3. 同 ID 跨来源可读；短 ID 歧义拒绝；exact path fixed 绑定正确；只读 Memory 导致相关 adoption 整批零写入。
4. 配置仅改注释使新 fixed 证据失效；额外来源中的非 owner 文件仍影响 candidate。
5. 非 TTY 默认 draft；显式采用 active；伪 anchor 不被认领；重复 anchor 和删除引用有诊断；宪法缺失不阻碍 recover。

## 挑战记录

2026-09-14：Herdr concord-init-grill-0914，GPT-6 Astra，只读独立上下文。六项首轮问答后给 CONDITIONAL，条件为上述格式/状态、锚点解析、恢复授权和组合验收定义。父 agent 已将前三项写成明确契约、第四项写成验收定义并逐项核对。该记录不表示实现通过。
