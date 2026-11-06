# 本地 SDLC 闭环

功能该做成什么样、代码怎么实现、哪些测试在守护它，通常散落在聊天记录、PR 描述和各人的记忆里。Concord 把它们放回同一个 Git 仓库：Spec 写在 `docs/`，测试和代码用一行标记指向 Spec，`concord check` 核对三者是否仍然一致。

面向的读者是维护者和 coding agent。全部内容都是仓库里的普通文件，可以直接编辑，不需要账号、模型 API 或云服务。

## 你可以做什么

- **先写 Spec 再动手。** 用 Feature 描述能力，用 Use Case 一步一步写出使用者的路径；方案有争议时，先比较候选方案再裁决。
- **把测试和代码连到 Spec。** 在测试或实现文件里写一行标记，Concord 从源码反查出某个 Use Case 由哪些测试守护、由哪些代码实现。
- **找出没有关联 Use Case 的测试。** 每个测试标注它验证的 Use Case 或其中一步；`concord test discover` 收集测试运行器认识的全部测试后，`concord trace gaps` 列出没有关联任何 Use Case 的测试。缺少关联不表示测试没有价值，维护者需要结合测试目的决定如何处理（[只声称证明过的](../../taste.md#t-5)）。
- **让 check 守住一致性。** Spec 被删除、改名或标记写错时，`concord check` 指出出错的文件和行。
- **用证据关闭缺陷。** 缺陷记为 Issue。回归测试在缺陷提交上失败、在修复提交上通过，Concord 核验这两点后才把 Issue 关为已修复。
- **积累工程知识。** 调查结论、根因和裁决写成 Memory，之后可以按关键词检索。

## 上手：从一个 Use Case 到一次通过的检查

下面的命令在一个空的 Git 仓库里运行，输出来自实际执行。

1. 初始化项目，并创建一个 Feature 和它的第一个 Use Case：

   ```sh
   concord init
   concord new feature cart --title "购物车"
   concord new use-case add-item --feature cart --title "加入商品"
   ```

   ```text
   Applied new:
     docs/feature/cart/use-case/add-item.md

   Next: edit the pages, then run concord check.
   ```

   打开 `docs/feature/cart/use-case/add-item.md`，按模板写下谁要做什么、每一步运行什么、看到什么结果。

2. 让测试指向这个 Use Case。`test marker` 生成可以直接粘贴的标记：

   ```sh
   concord test marker --contract docs/feature/cart/use-case/add-item.md
   ```

   ```text
   // @use-case docs/feature/cart/use-case/add-item.md
   ```

   把它放在 `test/cart.test.js` 顶部。实现文件用 `concord code marker` 生成的 `@concord-implements` 标记指向 Feature。

3. 运行检查：

   ```sh
   concord check
   ```

   ```text
   check
   ok: true
   complete: true
   findings: none
   ```

   `concord show docs/feature/cart/use-case/add-item.md` 列出守护这个 Use Case 的测试：

   ```text
   tests:
     neref_854212737ecad7effc4666629752cb98 — test/cart.test.js:1
       Contract: docs/feature/cart/use-case/add-item.md
       Declaration: active
   ```

4. 有人把 Use Case 改名成 `add-to-cart.md`，测试里的标记却没有跟着改。再运行检查：

   ```text
   check
   ok: false
   complete: false
   findings:
     test/cart.test.js:1
       ReferenceNotFound: Reference target does not exist: docs/feature/cart/use-case/add-item.md
   ```

   检查以退出码 1 失败，指出标记所在的文件和行。改正标记后重新通过。

完整的命令清单、JSON 输出和错误码见[命令体验](cli.md)。

## Spec、测试与实现怎样保持一致

Spec 是唯一的事实来源。测试和实现各自在源码里声明指向哪一份 Spec，反向关系由 Concord 从源码推导，不另存一份登记表。`check` 每次都重新核对这些指向。

```p5
import type P5 from 'p5';
export default function (p: P5) {
  const captions = [
    '1. 在 docs/ 中写下 Spec：Feature 与 Use Case',
    '2. 测试与实现用标记指向 Spec',
    '3. concord check 核对每一条指向',
    '4. Spec 改名而标记没改：check 报告断开的指向',
  ];
  const nodes = [
    { label: 'Spec', x: 300, y: 50 },
    { label: '测试', x: 150, y: 170 },
    { label: '实现', x: 450, y: 170 },
  ];
  let elapsed = 0;
  p.setup = () => {
    p.createCanvas(600, 260);
    p.describe('Spec、测试、实现三个方框；测试与实现依次画出指向 Spec 的连线，check 逐条核对，最后一轮中一条连线断开并显示为红色，随后循环');
    p.textAlign(p.CENTER, p.CENTER);
  };
  const box = (x: number, y: number, label: string, active: boolean) => {
    p.stroke(150);
    p.fill(active ? '#d8eee7' : '#ffffff');
    p.rect(x - 60, y - 22, 120, 44, 8);
    p.noStroke();
    p.fill('#203b33');
    p.textSize(15);
    p.text(label, x, y);
  };
  const link = (from: { x: number; y: number }, to: { x: number; y: number }, t: number, color: string, broken: boolean) => {
    const ex = p.lerp(from.x, to.x, t), ey = p.lerp(from.y - 22, to.y + 22, t);
    p.stroke(color);
    p.strokeWeight(2);
    if (broken) {
      p.line(from.x, from.y - 22, p.lerp(from.x, ex, 0.45), p.lerp(from.y - 22, ey, 0.45));
      p.line(p.lerp(from.x, ex, 0.6), p.lerp(from.y - 22, ey, 0.6), ex, ey);
    } else {
      p.line(from.x, from.y - 22, ex, ey);
    }
    p.strokeWeight(1);
  };
  p.draw = () => {
    elapsed = (elapsed + Math.min(p.deltaTime, 100)) % 12000;
    const step = Math.floor(elapsed / 3000);
    const t = p.constrain((elapsed % 3000) / 1500, 0, 1);
    p.background(247);
    const [spec, test, impl] = nodes;
    if (step >= 1) {
      const grow = step === 1 ? t : 1;
      link(test!, spec!, grow, step >= 2 ? '#28775c' : '#8a9a95', step === 3);
      link(impl!, spec!, grow, step >= 2 ? '#28775c' : '#8a9a95', false);
    }
    if (step === 3) {
      p.stroke('#a33a2c');
      p.strokeWeight(2);
      p.line(test!.x + 52, 102, test!.x + 68, 118);
      p.line(test!.x + 68, 102, test!.x + 52, 118);
      p.strokeWeight(1);
    }
    box(spec!.x, spec!.y, spec!.label, step === 0);
    box(test!.x, test!.y, test!.label, step === 1 || step === 3);
    box(impl!.x, impl!.y, impl!.label, step === 1);
    if (step >= 2) {
      p.noStroke();
      p.fill(step === 3 ? '#a33a2c' : '#28775c');
      p.textSize(13);
      p.text(step === 3 ? 'check：ReferenceNotFound' : 'check：ok', 300, 130);
    }
    p.noStroke();
    p.fill('#203b33');
    p.textSize(13);
    p.text(captions[step]!, 300, 235);
  };
}
```

## 用户路径

开始一个项目或一项功能：

- [接入并取得模板](use-case/onboard-from-template.md)
- [规划并采用文档 Spec](use-case/plan-and-adopt-contracts.md)
- [逐项比较方案并明确裁决](use-case/compare-design-plans.md)

把测试和代码连到 Spec：

- [把测试关联到 Use Case 步骤](use-case/link-tests-to-steps.md)
- [发现测试并重建缓存](use-case/discover-annotated-tests.md)
- [从源码追踪实现归属](use-case/trace-code-ownership.md)
- [分析其它语言的代码声明与测试依赖](use-case/analyze-other-languages.md)
- [通过 adapter 执行原生测试用例](use-case/run-native-test-adapters.md)

检查与审阅：

- [检查 Spec 与 CLI 页面的实现和测试关系缺口](use-case/inspect-relationship-gaps.md)
- [找出没有关联 Use Case 的测试](use-case/find-unlinked-tests.md)
- [追踪 Spec 并生成审阅材料](use-case/review-traceability.md)
- [在编辑器中查看 Concord 关系](use-case/use-editor-service.md)

修复缺陷与积累知识：

- [核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)
- [检索与维护工程知识](use-case/recall-and-maintain-memory.md)

保护工作区：

- [保护并恢复本地状态](use-case/recover-local-state.md)

## 范围

- 初始化文档布局、写作指南、完整参考模板与可选的项目配置，不覆盖已有文件。
- 按固定布局组织 Feature、Use Case、Roadmap、Design、Engineering、Issue 与 Memory；身份由路径决定，名称由一级标题决定，frontmatter 只保存推导不出的字段（[文档与标记格式](format.md#owner)）。
- 全部文件直接编辑；`new`、`roadmap start`、`issue close` 等命令执行需要运行的步骤并把结果写进文件。
- 从整文件、函数和完整代码段旁的注释反查 Feature / Use Case / Engineering 实现关联，支持按源码行定位；查询引用自动派生，无需手写声明 ID。
- 从测试根里的 Concord 标记发现 case，不解析宿主测试语法。缓存损坏或删除时从源码重新计算。
- 运行项目声明的 argv；把 Issue 关闭为 fixed 前，核验回归测试在缺陷提交上失败、在修复提交上通过，并把结论写进 Issue（[核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)）。
- 写入不越出 worktree，不覆盖未知改动，中断后可以恢复。
- 从 Spec 动态编译 trace，并渲染本地 review 材料。

`concord trace gaps --json` 派生当前显式实现与测试关系缺口，帮助发现尚未建立关系的 Spec 和已建档的 CLI 页面；它不等于代码覆盖率，也不能发现从未建档的命令。

Concord 不把修复核验描述成原生 runner 的逐 case 覆盖率或 formal E2E；不自动发布、push、调用付费模型或操作远端 Issue；缓存不保存任何无法从源码重建的事实。

## 证据的范围

证据只表达实际证明的范围（[只声称证明过的](../../taste.md#t-5)）。

1. 源码声明不等于执行，命令成功收据不等于逐 case 覆盖或正式 E2E 可靠性。
2. Issue 标记为 fixed 时，同一冻结命令必须在缺陷候选上以非零结果结束、在被接受的快照上通过，两者之间测试、runner 输入与所指 Spec 不变。核验结论写入 Issue，可在声明的输入与环境下重放；command 结果不证明逐 case 执行。
3. 文档、品味结构或关系检查不得被展示为实现合规、功能完成或测试覆盖的证明。

## 测试的边界

Concord 用源码标记把测试关联到 Spec，通过配置的 `runner` 运行测试，并只按 runner 的退出码解释结果。它不登记测试套件，不签发原生 case 覆盖或正式可靠性结论（[证据的范围](#证据的范围)）。

| 归属 | 内容 |
| --- | --- |
| 项目拥有 | 测试框架与原生 runner、执行环境与执行副本、候选产品的构建与安装、进程与容器等外部资源的清理，以及何时、在哪个通道执行哪些测试 |
| Concord 拥有 | 发现范围、源码标记解析、稳定 case 身份、`concord test run`，以及以 fixed 关闭 Issue 前的修复核验 |

发现范围默认取存在的 `test/`、`tests/`，测试在其它位置时配置 `testRoots`。Concord 不读取 Nx metadata，也没有固定 e2e 目录、host/provider 分类或 pr/main/nightly/release 通道。所有权划分见[治理边界](../neutral-project-governance/architecture.md#所有权)。

逐 case 的原生证据、可靠性观察与政策下限不属于 Concord，需要它们的项目在自己的 CI 中实现，其结论不参与 Issue 的关闭判定。仓库中已有的治理配置与原生收据原地保留，Concord 不读取、不删除。接入验收见[按 Concord 规范接入软件项目](../neutral-project-governance/use-case/adopt-neutral-governance.md#验收)。

## 独立与本地

核心流程不需要账号、模型 API 或云服务。

1. Concord 作为独立安装包工作，只需要本地 Git 仓库，不依赖其它仓库的 checkout、全局安装、provider 凭据或部署服务。
2. 可选外部接入必须有明确边界，不成为基础本地流程的前提。
3. 本地 Issue 不依赖外部服务。远端写入需单独授权，本地操作不自动投射为远端变更。

## 写入安全

人和 agent 同时编辑同一个仓库时，Concord 的写入不能破坏别人的工作。

1. 所有写入必须校验目标路径、前像与完整变更集，拒绝路径逃逸和 symlink 绕过。
2. 中断时必须保留可解释的恢复现场，不覆盖未知编辑。
3. 新增配置、来源和写入口必须同时定义资源所有权与恢复授权。

## 验收

各 Use Case 均有带 `@use-case` 标记的测试。`concord check` 与 `trace check` 必须验证引用完整性；定向 `trace show` 与 `review` 必须能从当前 Spec 分别反查代码声明和测试。代码声明表示实现关联，不证明 Spec 完成。

局部命令只依赖自己的输入：

- 一个 Feature 的 README 损坏时，Memory 的 list、search 与 confirm 照常工作，为另一 Feature 生成注释照常工作，全局 check 报告该损坏。
- 目标 Spec、其归属链或显式 `@issue` 目标损坏时，局部命令失败，不退回上级 Spec。
- `memory/` 含无法解析的记录时，Memory 的集合查询与短选择器查询失败；另一 canonical path 的精确读取按必要依赖验证。

## 细节

- [命令体验](cli.md)：每个命令的调用、JSON 输出、退出码与错误。
- [文档与标记格式](format.md)：文档路径、Issue 与 Memory 的 frontmatter、测试与代码标记。
- [库接口](library.md)：库包 `concord-sdlc` 导出的子路径与安装方式。
- [性能预算](performance.md)：高频命令的 p50 预算。
- [实现](architecture.md)

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [写现在，不写过去](../../taste.md#t-4)
- [快到每次都愿意跑](../../taste.md#t-7)
- [读得懂胜过写得全](../../taste.md#t-1)
