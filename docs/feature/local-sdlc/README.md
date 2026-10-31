# 本地 SDLC 闭环

功能该做成什么样、代码怎么实现、哪些测试在守护它，通常散落在聊天记录、PR 描述和各人的记忆里。Concord 把它们放回同一个 Git 仓库：Spec 写在 `docs/`，测试和代码用一行标记指向 Spec，`concord check` 核对三者是否仍然一致。

面向的读者是维护者和 coding agent。全部内容都是仓库里的普通文件，可以直接编辑，不需要账号、模型 API 或云服务。

## 你可以做什么

- **先写 Spec 再动手。** 用 Feature 描述能力，用 Use Case 一步一步写出使用者的路径；方案有争议时，先比较候选方案再裁决。
- **把测试和代码连到 Spec。** 在测试或实现文件里写一行标记，Concord 从源码反查出某个 Use Case 由哪些测试守护、由哪些代码实现。
- **让 check 守住一致性。** Spec 被删除、改名或标记写错时，`concord check` 指出出错的文件和行；CI 对每次变化运行 `concord check --since <base>`。
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
       ReferenceNotFound: Reference target does not exist: docs/feature/cart/use-case/add-to-cart.md
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
- [追踪 Spec 并生成审阅材料](use-case/review-traceability.md)
- [在编辑器中查看 Concord 关系](use-case/use-editor-service.md)

修复缺陷与积累知识：

- [核验修复并关闭缺陷](use-case/resolve-with-command-evidence.md)
- [检索与维护工程知识](use-case/recall-and-maintain-memory.md)

保护工作区：

- [保护并恢复本地状态](use-case/recover-local-state.md)

## 细节

- [命令体验](cli.md)：每个命令的调用、JSON 输出、退出码与错误。
- [领域与数据所有权](library.md)：文档身份、路径与字段的归属。
- [范围与验收](scope.md)：本 Feature 包含和不包含的能力，以及局部命令的输入边界。
- [性能预算](performance.md)：高频命令的 p50 预算。
- [实现](architecture.md)

## 依据的品味

- [一件事只写一次，其余推导](../../constitution.md#c-019)
- [只声称证明过的](../../constitution.md#c-021)
- [写现在，不写过去](../../constitution.md#c-020)
- [快到每次都愿意跑](../../constitution.md#c-023)
- [读得懂胜过写得全](../../constitution.md#c-017)
