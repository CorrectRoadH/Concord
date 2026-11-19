# Feature 锚点级的测试缺口

## 现象

NiceEval 把每个 Feature 必须成立的性质写在 Feature README 的「性质」一节，每条性质是一个带锚点的小节（例如 `docs/feature/run/README.md#interrupt-recovery`），测试用 `// @feature <路径>#<锚点>` 标记指向它。

`concord test marker --contract 'docs/feature/run/README.md#reference-deletion'` 接受锚点并生成 `@feature` 标记；但 `concord trace gaps` 只按 owner 与页面统计缺口，不枚举 Feature 页内尚未被任何标记指向的锚点。于是一个 Feature 页只要有一条性质被测试，其余未测试的性质就不会出现在缺口列表里。

## 期望

`trace gaps` 能把 Feature 页内声明为验收单元的锚点（例如「性质」一节下的各小节）作为独立的缺口项，与 Use Case 步骤的缺口同样派生；有标记指向的锚点不列入缺口。
