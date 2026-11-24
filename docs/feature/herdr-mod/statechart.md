# 保存后后台检查的状态

在 Herdr 里保存文档只等写入与读回；检查在后台运行，连续保存合并为最新的待检查代次，用户还会切页、切仓库或关闭 mod。这一页用模型检查器核对[后台检查](architecture.md#background-check)的规则。

## 规则

### 每个仓库会话最多一个检查 {#AtMostOneCheckPerRepositorySession}

一个仓库会话同一时刻最多一个受管的在途检查。

### 只有当前代次的检查能发布 {#OnlyCurrentCheckMayPublish}

只有当前代次、仍活跃的会话的检查结果能写入结论，并且只显示在它所属的仓库里。旧代次的检查与晚到的投影都不能覆盖更新的结论。

### 检查失败不撤销保存 {#CheckFailureDoesNotUndoSave}

写入成功就是成功；检查失败单独显示。

### 最后一次保存最终会被检查 {#LatestPendingCheckEventuallyStarts}

不再保存、会话仍在、在途检查最终结束时，最后一个待检查代次一定会开始检查。

## 模型

```statechart spec="./tla/HerdrSaveCheck.tla" config="./tla/current.cfg" view="./tla/herdr-save-check-view.ts" out="./tla/out/current" digest="sha256:1fbcb7dd784daaf5b59405e01e8ada3428679d0d829aa0d332f45126a029e5b9"
```

两个仓库会话、三个保存代次、一次检查问题与一次检查失败，加上切页、切仓库、淘汰会话、关闭 mod 与晚到的回复。四条规则都成立。

## 按路径重放的测试

`test/model/herdr-mod.test.ts` 重放 `OnlyCurrentCheckMayPublish` 的路径：刷新开始读取投影，随后保存并检查出问题，最后旧投影才返回。旧投影曾把新检查的问题清空；现在刷新会核对开始时的检查代次，问题仍然显示。

## 动作与代码

| 动作 | 代码 |
| --- | --- |
| 保存、读回、递增代次 | `src/entry/herdr-mod/session.ts`；`src/entry/herdr-mod/main.ts` 启动后台检查 |
| 开始与结束检查 | `src/entry/herdr-mod/main.ts` 的每会话任务表；`src/entry/herdr-mod/session.ts` 核对代次 |
| 读取与接收投影 | `src/entry/herdr-mod/session.ts` |
| 切页、切仓库、淘汰会话、关闭 | `src/entry/herdr-mod/main.ts` |

## 模型没有覆盖的部分

文档正文、渲染、CLI 版本替换与远程 core 的连接失败。
