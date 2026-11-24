# 安装与发版的状态

这一页用模型检查器核对两段靠读脚本难以确认的流程：安装脚本的发布、链接切换与旧版本回收，以及标签发版的失败重试与不可变资产。

## 安装脚本

安装脚本在 `~/.local/share/concord/` 下发布版本目录、原子切换链接、按激活时间保留最近两个旧版本，正在运行服务的版本不删，见[安装脚本](architecture.md#安装脚本)。中断、第二个安装者与服务启动可能交错。

### 规则

#### 链接指向已校验的安装 {#ActiveLinkTargetsVerifiedInstallation}

激活的链接始终指向存在且已校验完成的版本目录。

#### 已有版本的字节不变 {#ExistingVersionBytesAreImmutable}

同一版本已存在时，只在收据相同时复用，安装不覆盖它的字节。

#### 回收不删当前与使用中的版本 {#RetentionPreservesCurrentAndLiveVersions}

回收只删除不是当前、没有存活标记、且不在保留名额内的版本。

### 模型

```statechart spec="./tla/install/Installation.tla" config="./tla/install/single.cfg" view="./tla/install/install-view.ts" out="./tla/install/out/single" digest="sha256:362c66778b53c9b7da87dfb449bed96565b4750007d1174961b2246beeff066d"
```

```statechart spec="./tla/install/Installation.tla" config="./tla/install/concurrent.cfg" view="./tla/install/install-view.ts" out="./tla/install/out/concurrent" digest="sha256:98fd4def9a227f28e48543542df2330083fffca5c2c8b7ba32f8682792ef1efd"
```

一个安装根、一个链接、六个版本（当前、新候选、使用中的旧版与三个不活跃的旧版）、一个可以退出再在旧版重启的服务、一次可捕获的中断。第一块只有一个安装者；第二块加入请求同一候选或回退最老版本的第二个安装者，状态数超过图的规模上限，只显示检查报告。三条规则都成立。

### 按路径重放的测试

- `test/process/install-script-link.test.ts`：链接 rename 成功后收到 TERM，退出清理曾删除刚激活的版本目录；现在保留它并补记激活。
- `test/process/install-script-retention.test.ts` 与 `test/domain/installation-use-marker.test.ts`：同版本并发安装、回收期间另一个安装回退、回收检查后才出现的标记、安装根已被移走时启动的服务。现在安装根加锁，删除前先改名再复查标记，安装根消失时服务报 `InstallationUnavailable` 拒绝启动。

## 标签发版重试

推送标签后，发版检出显式标签，只在同一 commit 的检查与打包通过后上传；失败的运行最多自动重试一次，复用的资产必须与 commit、版本与摘要一致，见[复用](architecture.md#复用)。

### 规则

#### 上传前检查通过 {#PublishRequiresPassingChecksForTagCommit}

上传资产前，标签所在 commit 的检查与打包都已成功。

#### 重试不改变资产 {#RetryPreservesImmutableAssetIdentity}

重试复用的资产与 commit、版本和摘要一致，不覆盖不同的字节。

#### 最多一次自动重试 {#AtMostOneAutomaticRetry}

一个运行最多自动重试一次。

#### 首次失败最终被重试 {#FirstFailedRunEventuallyRetries}

标签触发的发版首次失败、平台可用时，最终自动安排一次重试。

### 模型

```statechart spec="./tla/release/TaggedRelease.tla" config="./tla/release/exact-run-watch.cfg" view="./tla/release/tagged-release-view.ts" out="./tla/release/out/exact-run-watch" digest="sha256:7a51ceb17e5b5b542508e4e9f8a620986cc32965b7d9a6c3017649e2569efe08"
```

一个标签 commit、一个候选资产、两种分派来源、两次尝试；平台可能不投递完成事件。四条规则都成立。

### 按路径重放的测试

`test/process/tagged-release-retry.test.ts` 用本地替身代替 GitHub，重放标签分派的步骤：以默认令牌分派的发版失败时，GitHub 不投递完成事件，重试订阅从未运行（v0.15.0 的真实运行即如此）。现在标签分派取得确切的运行 ID 并观察它，首次失败时按这个 ID 安排一次失败任务重试；订阅入口跳过自己分派的运行。
