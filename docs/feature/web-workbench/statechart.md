# Web 工作台的状态

这一页用模型检查器穷举 Web 工作台里靠读代码难以确认的交错，每段先写规则，再给模型与检查结果。

## HTTP 监听与 SSE

同一地址的 `concord view` 与 Herdr 面板共用一个 HTTP 监听，引用归实例 token；浏览器的 SSE 连接让监听保持，面板的临时引用在没有 SSE 十分钟后释放，见[服务托管](architecture.md#服务托管)。view 退出、SSE 清理、定时检查与重新打开可能交错。

### 规则

#### 一个地址一个监听 {#OneListenerPerAddress}

同一实例的同一 host 与端口最多有一个监听。

#### 有引用时监听保持 {#ActiveReferenceKeepsListener}

仍有引用或 SSE 连接时，监听不被关闭，也不从登记中消失。

#### 只释放自己的引用 {#ReleaseIsScopedToOwnerAndToken}

view 断开只释放它自己的引用；实例 token 不符的关闭请求不释放任何引用。

#### 没人用的监听最终关闭 {#UnusedListenerEventuallyCloses}

没有新引用与 SSE、只剩面板的临时引用时，监听在空闲期限后由定时检查关闭。

### 模型

```statechart spec="./tla/http-leases/HttpLeases.tla" config="./tla/http-leases/current.cfg" view="./tla/http-leases/http-leases-view.ts" out="./tla/http-leases/out/current" digest="sha256:278f2dcb8a09f3f373a362e30b51899d63925455d87c2cde8ea290db7193e483"
```

一个服务、一个地址、两个 view、一个面板引用、同一时刻一个 SSE，最多创建两代监听。四条规则都成立。网络 I/O 失败、开启动作被取消、SSE 校验阶段与进程退出清理不在模型内。

### 按路径重放的测试

`test/domain/workspace-http-leases.test.ts` 重放三条路径，共同的开头是：view 打开监听并连上 SSE，浏览器断开、清理排队，旧监听关闭，同一地址重新打开。旧的 SSE 清理曾删除新一代的登记，于是同一地址出现第二个监听、仍被引用的监听丢失登记、只剩面板引用的监听永远不关。现在清理核对自己所属的代次；面板引用从取得时间与最后一次没有 SSE 的时间中较晚者开始计时；已断开的响应不能再订阅。

### 动作与代码

| 动作 | 代码 |
| --- | --- |
| 打开监听、发引用 | `src/entry/server/main.ts` 区分 view 与面板；`src/entry/server/http-leases.ts` 串行登记与复用 |
| view 断开、按 token 释放 | `src/entry/server/main.ts`；`src/entry/server/http-leases.ts`；`src/entry/cli/main.ts` 的 view 退出 |
| SSE 连接与清理 | `src/entry/http/view-server.ts`；`src/entry/server/http-leases.ts` 核对代次 |
| 空闲计时与定时检查 | `src/entry/server/http-leases.ts`；`src/entry/server/main.ts` |

## 草稿、自动保存与离开

编辑器只有一个活动的 owner；自动保存串行进行，保存途中的续写留给下一次保存；离开页面要等最新草稿保存，或由用户明确丢弃。保存失败保留 URL 与草稿，外部修改按摘要冲突处理并保留两边内容，见[自动保存](ui.md#自动保存)与[编辑与观察生命周期](architecture.md#编辑与观察生命周期)。

### 规则

#### 离开要等最新草稿 {#NavigationWaitsForLatestDraft}

带草稿的离开只有在当前最新版本已经保存、或用户明确丢弃之后才能继续。

#### 过期的离开不能继续 {#StaleNavigationCannotProceed}

已经被新的离开请求替代的回调不能再更改 URL。

#### 旧 owner 的清理不影响新 owner {#OldOwnerCleanupPreservesNewOwner}

旧编辑器卸载时的清理，不移除新编辑器的未保存标记、保存与丢弃能力。

#### 冲突保留草稿与磁盘 {#ConflictPreservesDraftAndDisk}

摘要冲突时同时保留草稿与外部写入的磁盘版本；保存失败时原 URL 不变。

### 模型

```statechart spec="./tla/drafts/WebDrafts.tla" config="./tla/drafts/navigation.cfg" view="./tla/drafts/drafts-view.ts" out="./tla/drafts/out/navigation" digest="sha256:06260c45045252abe9ee83821e11b10fd418bd535d7d93c2270815755eb2f48e"
```

```statechart spec="./tla/drafts/WebDrafts.tla" config="./tla/drafts/conflict.cfg" view="./tla/drafts/drafts-view.ts" out="./tla/drafts/out/conflict" digest="sha256:acf3a4f1bd56bfdf6656dd8da44ea4ced55b96b8eeb98b379f7b74fbcd05cfcc"
```

```statechart spec="./tla/drafts/WebDrafts.tla" config="./tla/drafts/owner.cfg" view="./tla/drafts/drafts-view.ts" out="./tla/drafts/out/owner" digest="sha256:f1c9c305b00eecdca36a433e1ffefb3d79944e893012c9e4ddf0940a3d6533bf"
```

```statechart spec="./tla/drafts/WebDrafts.tla" config="./tla/drafts/undo.cfg" view="./tla/drafts/drafts-view.ts" out="./tla/drafts/out/undo" digest="sha256:4ac6257dd3ecc24174ab5273e393764f00a5dcfdeabd8effca17d8a6a65287e7"
```

```statechart spec="./tla/drafts/WebDrafts.tla" config="./tla/drafts/full.cfg" view="./tla/drafts/drafts-view.ts" out="./tla/drafts/out/full" digest="sha256:de40bfeee45cfc121574803b9188843b9694f5516753c96114d68144a34b673f"
```

两个编辑器 owner、两个离开目标、一个文件、三代草稿、一个在途保存，服务器返回成功、冲突或失败。前四块分别看离开、冲突、owner 交替与撤销回旧基线；最后一块合在一起，状态数超过图的规模上限，只显示检查报告。四条规则都成立。

### 按路径重放的测试

`test/model/web-draft-navigation.test.ts` 用真实的 React Router 重放三条路径：保存途中第二次离开替代了第一次，第一次的保存回调曾仍跳到第一个目标；确认丢弃后等待在途写入时浏览器后退，旧回调曾仍跳到原目标；草稿撤销回旧基线时在途写入曾被当作已保存。现在离开前读取路由器当前的阻挡对象，过期的成功与失败回调都退出，在途写入一直计入待保存。

### 动作与代码

| 动作 | 代码 |
| --- | --- |
| 阻挡离开、继续或丢弃 | `web/app.tsx`；`web/lib/draft-navigation.ts` |
| 编辑器 owner | `web/workspace.tsx` |
| 自动保存循环 | `web/hooks/use-auto-save.ts` |
| 保存、读回与冲突 | `web/components/markdown-editor.tsx` |
