# 文档写作与领域术语

人和 AI 一起写 Spec 时，同一个东西常被叫成好几个名字，句子也越写越长，读者最后不知道哪个词指什么。这个 Feature 让项目把术语和写作规则写成仓库里的文件，`concord check` 每次都按它们检查正文，并告诉作者该怎么改。

## 你可以做什么

- 在 `concepts.md` 里给每个领域概念定一个名字和一段定义。概念改名后，旧名字会被检查报告出来，并给出新名字。
- 在 `concord-writing.json` 里列出不该用的词，每条附上替换写法和理由；也可以限制句子与段落的长度。
- 按目录划分术语：全局概念对整个 `docs/` 生效，Feature 目录里的概念只在该 Feature 内生效，不同 Feature 可以用同一个词表示不同的东西。
- 在 Web 工作台查看全项目术语、编辑规则，并看到每条问题出现在哪一行。

## 上手：让旧名字无处可藏

假设项目把“订单”定为正式名称，不再用“单子”。在 `docs/concepts.md` 写下定义，并把旧名字列为弃用名：

```markdown
---
deprecated:
  order: [单子]
---

# Project concepts

## 订单 {#order}

顾客提交的一次购买，包含商品、数量和收货地址。
```

某页正文写了“顾客确认单子后，系统锁定库存。”，运行检查：

```sh
concord docs check
```

```text
Documentation writing: failed (47 files)
Mode: project; selection: docs
Policy: project
docs/concepts.md:1 [unusedConcept] No selected prose uses docs/concepts.md#order
docs/feature/cart/README.md:27 [bannedTerm] 单子: use 订单; docs/concepts.md#order
```

检查指出旧名字所在的行，并给出正式名称和定义的位置。由于正文还没有用到“订单”，这个概念同时被报告为未使用。把正文改成“顾客确认订单后”，再运行一次：

```text
Documentation writing: passed (47 files)
Mode: project; selection: docs
Policy: project
```

## 检查怎样工作

检查读取正文，在当前目录生效的术语和禁词里查找匹配，再报告位置和建议写法。它只报告，不改正文。

```p5
import type P5 from 'p5';
export default function (p: P5) {
  const stages = ['正文', '术语与禁词', '检查报告'];
  const notes = ['顾客确认单子后，系统锁定库存。', '订单（弃用名：单子）', 'README.md:27 单子 → 订单'];
  let elapsed = 0;
  p.setup = () => {
    p.createCanvas(600, 210);
    p.describe('正文、术语与禁词、检查报告三个方框依次突出显示，旧名字被匹配后报告为应改成正式名称，然后循环');
    p.textAlign(p.CENTER, p.CENTER);
  };
  p.draw = () => {
    elapsed = (elapsed + Math.min(p.deltaTime, 100)) % 7500;
    const step = Math.floor(elapsed / 2500);
    const progress = p.constrain((elapsed % 2500 - 1000) / 1200, 0, 1);
    p.background(247);
    for (let i = 0; i < stages.length; i++) {
      const x = 100 + i * 200;
      p.stroke(150);
      p.fill(i === step ? '#d8eee7' : '#ffffff');
      p.rect(x - 85, 40, 170, 90, 8);
      p.noStroke();
      p.fill('#203b33');
      p.textSize(15);
      p.text(stages[i]!, x, 62);
      p.textSize(11);
      p.fill(i === 2 ? '#a33a2c' : '#4a5a55');
      p.text(notes[i]!, x - 78, 80, 156, 44);
      if (i < stages.length - 1) {
        p.stroke(150);
        p.line(x + 85, 85, x + 115, 85);
      }
    }
    if (step < stages.length - 1) {
      p.noStroke();
      p.fill('#28775c');
      p.circle(185 + step * 200 + progress * 30, 85, 9);
    }
    p.noStroke();
    p.fill('#203b33');
    p.textSize(13);
    const captions = ['读取所选目录下的 Markdown 正文', '按目录合成生效的概念、弃用名和禁词', '报告位置与正式名称，正文保持不变'];
    p.text(captions[step]!, 300, 170);
  };
}
```

## 聚合门禁

`concord check` 把写作检查和关系检查合成一次结果，作为每次交付必须通过的门禁；有问题时退出码为 1。必查范围、必需规则、JSON 结果与退出码见[聚合门禁规则](gate.md)。

## 用户路径

- [检查正文与术语](use-case/inspect-writing.md)
- [按目录管理结构化术语与写作规则](use-case/manage-scoped-terminology.md)
- [应用受控写作规则](use-case/apply-controlled-writing.md)
- [在 Web 管理写作规则与术语](use-case/manage-writing.md)

## 细节

- [文件格式与作用域](policy.md)：`concepts.md` 与 `concord-writing.json` 的结构、目录合成、匹配方式、工具写入与恢复。
- [聚合门禁](gate.md)：`concord check` 的必查范围、必需规则、JSON 结果与退出码。
- [实现](architecture.md)

## 依据的品味

- [一件事只写一次，其余推导](../../taste.md#t-3)
- [只声称证明过的](../../taste.md#t-5)
- [总则](../../taste.md#general-amend)
- [写现在，不写过去](../../taste.md#t-4)
- [读得懂胜过写得全](../../taste.md#t-1)
