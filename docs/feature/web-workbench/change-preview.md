# 变更审阅

本地工作台展示当前工作区；PR 预览展示冻结提交。用户路径见[本地未提交变更](use-case/review-local-changes.md)与[PR 预览](use-case/review-pull-request.md)，`view export` 的调用与错误见 [CLI 页](cli.md#pr-静态预览导出)。本页声明 PR 静态导出的实现（[一件事只写一次，其余推导](../../constitution.md#c-019)、[独立、本地、可安装](../../constitution.md#c-002)、[写入遵守范围和恢复 Spec](../../constitution.md#c-003)、[尊重协作与外部操作授权](../../constitution.md#c-007)、[快到每次都愿意跑](../../constitution.md#c-023)）。

PR 预览是静态产物而非托管服务，避免向读者暴露仓库写入与执行能力（[决策依据](../../design/pr-change-preview/DECISION.md)）；它与本地工作台共用文件树和 diff 组件。导出不要求项目配置有效，不加载消费者配置或源码，不建立持久缓存，不联网。

## 比较身份

base 与 head 作为独立 argv 经 `rev-parse --verify --end-of-options <ref>^{commit}` 解析为完整 commit ID，此后只用 ID。拒绝 shallow 仓库。`merge-base --all` 必须恰好返回一个祖先；比较它与 head，产物保留原始 base。

随后在 Scope 管理的私有 0700 临时目录建空 bare 仓库，以 alternate object directory 只读访问来源对象，不复制 config、refs、index、info/attributes 或工作树，HEAD 不指向来源提交。Git 子进程清除继承的 GIT 环境，禁用 global/system config、system attributes、replace refs、lazy fetch、提示与可选锁；提交中的 `.gitattributes` 只是被审阅文件。

差异使用 literal pathspec、`--no-ext-diff`、`--no-textconv`、`--ignore-submodules=none`、`--submodule=short`、50% rename 阈值与 2000 rename limit，不检测 copies。NUL 分隔的 raw diff 给出状态、完整对象 ID、模式与 UTF-8 路径；patch 由该 entry 的两个 blob 生成。gitlink 只显示 commit ID，symlink 只显示 blob，不跟随。非 UTF-8 或含 NUL 的正文按二进制处理。

## 预算

| 对象 | 上限 |
| --- | --- |
| entries | 2000 |
| 枚举 stdout | 2 MiB |
| 单个被比较 blob（读取前用 `cat-file` 预检大小） | 4 MiB |
| 两侧累计 blob 读取 | 64 MiB |
| 单个 patch | 2 MiB |
| Markdown 每侧 | 1 MiB |
| `changes.json` | 8 MiB |
| 每个 Git 进程 | stderr 64 KiB，stdout 有界，10 秒 |
| 整个导出 | 120 秒 |
| 静态资源 | 单文件 10 MiB，总量 64 MiB，连同 `changes.json` 不超过 256 个文件 |

大对象即使 patch 很小也拒绝。超限、超时或取消先终止 Git 子进程并等待 close（必要时 SIGKILL），再释放临时目录；不发布部分结果。

## 产物格式

`concord.change-preview/v1` 由随包导出 `concord-sdlc/change-preview` 的 `ChangePreviewSchema` 与 `decodeChangePreview` 拥有；浏览器与消费者共用这一严格解码器，拒绝未知字段与版本。

| 字段 | 语义与约束 |
| --- | --- |
| format | 字面量 `concord.change-preview/v1` |
| comparison | base、head、mergeBase 为同一对象格式的 40 或 64 位小写十六进制 ID；baseLabel 为非空纯文本，最多 256 字符，只作展示，默认等于输入的 base |
| entries | 最多 2000 项；path 唯一，取 head 路径，删除时取旧路径；UTF-8 仓库相对路径，无 NUL、空段、`.` 或 `..` |
| entry.status | A、D、M、R、T；R 必须有与 path 不同的 previousPath，其余不得有 |
| entry.before / after | null 表示该侧不存在，否则为 `{oid, mode}`；mode 为字符串 100644、100755、120000 或 160000；before 取 mergeBase 的 previousPath 或 path，after 取 head 的 path；A 的 before、D 的 after 必须为 null，其余两侧都存在，oid 长度与 comparison 一致 |
| entry.patch / binary | patch 为统一差异文本；二进制、纯模式变化与内容不变的 rename 的 patch 可为空字符串，界面仍显示状态与两侧对象 |
| entry.beforeMarkdown / afterMarkdown | 仅当对应侧为普通文件模式、后缀 `.md`/`.markdown` 且非二进制时存在；空字符串是空正文，缺失表示不适用 |

输出固定为 `index.html`、`changes.json` 与 `assets/`，资源从随包静态目录派生，拒绝 symlink。链接相对输出目录；hash query 拥有 `path`、`view`（unified/split）与 `content`（diff/before/after）。

## 输出生命周期

输出必须是父目录已存在的新目录，不能是仓库根、Git-private 路径或有 symlink 祖先。祖先属于调用者信任的文件系统；本命令不防御同权限恶意进程，祖先检查不是原子路径锁。支持与正常 Git 编辑及其它导出并发：目标以独占 mkdir 创建。

读取、Schema 与预算检查完成后才非递归 mkdir 0700，登记祖先与目标的 dev/ino 并在每次创建文件前及完成后核对；文件以 `wx` 创建，`index.html` 最后写。失败或取消保留不完整输出并报告路径，不删除、不覆盖，以免误删被替换的同名文件。临时 Git 目录与输出分属不同所有权，由 Scope 回收。输出不含凭据、未提交文件或 Git metadata。

## 静态阅读器

阅读器只读 `changes.json`，不调用 `/api`，不依赖工作区、扫描、HawDB 或服务进程。文本经 React 转义；Markdown 用独立 react-markdown 入口而非本地渲染器：跳过原始 HTML，不渲染图片，不加载远程资源，链接只保留 https、http 与 mailto。

## 消费者接入

消费者拥有 PR 身份、Git 历史与托管，须满足：

- PR head 等于构建提交与 checkout HEAD，merge checkout 拒绝；构建前与发布前各查询一次 PR，base ref、base SHA 或 head SHA 变化即失败。
- 补全 shallow 历史与缺失对象后再导出。
- 发布前用随包 decoder 核对 `changes.json` 的 base、head、baseLabel，并独立计算 merge-base 比对。
- 以 lockfile integrity 固定的打包 tarball 安装 Concord，不依赖相邻源码或未发布版本，不手改 tarball。

## 验收

隔离 Git 消费者经已安装 CLI 与公共 decoder 覆盖 [PR 预览](use-case/review-pull-request.md#验收)，另含脏 attributes、replace refs、子模块忽略配置、非 UTF-8 路径、大对象小 patch，以及未初始化、无效配置与子目录启动；取消回收 Git 子进程与临时目录。部署与远端链接只由已授权的真实部署证明。
