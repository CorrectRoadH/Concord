# 反馈同步的状态

导入或同步远端反馈时，网络读取在锁外进行，写入时复核配置摘要；同一远端对象只对应一个本地 Issue，首次绑定与新增 Issue 同批发布；来源写入之后再合并观察缓存，缓存失败不撤销来源写入，见[远端来源](architecture.md#远端来源)与[远端观察的合并](../local-data-engine/architecture.md#远端观察的合并)。两个请求、两个连接与配置编辑可能交错，这一页用模型检查器核对这些规则。

## 规则

### 一个远端对象一个本地 Issue {#OneLocalIssuePerRemoteIdentity}

同一稳定的远端对象最多对应一个本地 Issue，经不同连接读到也复用它。

### 绑定与新 Issue 一起发布 {#BindingAndNewIssuesPublishTogether}

配置摘要复核通过后，首次绑定与这次新增的 Issue 在同一次来源写入中发布。

### 缓存失败不撤销来源写入 {#CacheFailureDoesNotUndoSourceCommit}

缓存更新失败时保留来源写入与原回执，`operationCompleted` 为真，不再重复发布。

### 观察版本不倒退 {#ObservationVersionNeverRegresses}

缓存只接受更新的内容，丢弃更旧的响应；时间戳相同而内容不同时保留已有内容并发出警告。

## 模型

```statechart spec="./tla/FeedbackSync.tla" config="./tla/versions.cfg" view="./tla/feedback-view.ts" out="./tla/out/versions" digest="sha256:3751c53d06fcfdcc911290260d5f1e6402131ff2fab0e5bb98731816ff887e27"
```

```statechart spec="./tla/FeedbackSync.tla" config="./tla/conflict.cfg" view="./tla/feedback-view.ts" out="./tla/out/conflict" digest="sha256:c6eaeb10b85ede405e4e78f75307b80f5a35e7fd53e8f9f8a237ada0da9f2904"
```

两个请求、两个连接、一个远端对象，初态覆盖两个连接都未绑定与都已绑定；一次外部配置编辑。来源写入是原子发布，之后的缓存合并可以调换顺序或失败。第一块固定两个时间戳的先后，第二块是同一时间戳的不同内容。四条规则都成立。

## 按路径重放的测试

`test/domain/feedback.test.ts` 重放 `ObservationVersionNeverRegresses` 的一条路径：两个相差不到一毫秒的远端版本曾被归一化成同一时间戳，第二次同步误报冲突。现在保留远端时间戳的小数秒，并按精确版本排序。服务持有缓存时，`commit` 之前断开的 `feedback-merge` 会话不会留下部分合并。

## 动作与代码

| 动作 | 代码 |
| --- | --- |
| 锁外读取远端 | `src/domain/feedback/feedback.ts`；CLI `src/entry/cli/cli-command-feedback.ts`；Web `src/app/application.ts` |
| 复核配置摘要、发布绑定与 Issue | `src/domain/feedback/feedback.ts`；`src/base/workspace/storage.ts`；`src/model/feedback-schema.ts` 派生稳定身份 |
| 合并观察缓存 | `src/base/cache/feedback-cache.ts`；服务路径 `src/entry/server/feedback-session.ts` |
| 缓存失败回执 | `src/domain/feedback/feedback.ts` |

## 模型没有覆盖的部分

远端失败与分页、令牌与范围解析、第三个请求、已有的重复手写 Issue、持久缓存清理、配置摘要碰撞与改回，以及 IPC 分帧细节。
