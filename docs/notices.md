# 来源与第三方声明

Concord 的源码来源包括 NiceEval 私有仓库的维护工具与工程 Spec。

- 来源：NiceEval `packages/repo-tools/src/`。
- 来源 revision：`e1c66d31115208ceaae2f5bd4d730a7abf67048d`。
- 来源概念：Feature / Use Case、源码拥有的 trace 关系、`Problem / Decision / Insight` 生命周期、受管写入和基于证据的审阅。

Concord 是独立的本地项目，不包含 NiceEval 的产品数据、凭据、部署配置或正式 E2E 证据实现。当前文档与领域定义见[文档模型](document-model.md)和[术语](concepts.md)。

## 随包第三方材料

Web 工作台的第三方库声明由构建生成在 `dist/web/.vite/license.md`。Fontsource 提供的 Noto Sans SC 字体采用 SIL Open Font License 1.1，完整声明随包放在 `dist/web/FONT-LICENSE.txt`。

隔离图解运行时随包提供 p5.js（LGPL-2.1），许可证在 `dist/web/P5-LICENSE.txt`，依赖声明在 `dist/web/p5-runtime.js.LEGAL.txt`。

可选扩展 p5.sound（LGPL-2.1）与 p5.brush（MIT）的 JavaScript 和相邻许可证文件保存在 `dist/web/p5-libraries/`。包版本由锁文件固定，图解从本地加载这些资源。

原生缓存引擎嵌入 [HawDB](https://github.com/nowledge-co/hawdb)，采用 Apache-2.0。固定 revision 由源码中的 `native/hawdb/UPSTREAM.txt` 声明，并随原生产物的 `UPSTREAM.txt` 分发。绑定依赖由 `native/hawdb/Cargo.lock` 固定。

引擎与依赖的许可证材料随目标产物保存在 `dist/native/`。HawDB 不拥有 Concord 的 Spec、Memory、Issue 或测试证据。
