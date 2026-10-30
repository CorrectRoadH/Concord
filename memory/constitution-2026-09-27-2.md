---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md
---

# docs 只写声明；接入项目采用 Concord 范式并以 concord check 执行写作门禁；性能成为交付约束

宪法修订，日期 2026-09-27。

## 理由

docs 只写声明；接入项目采用 Concord 范式并以 concord check 执行写作门禁；性能成为交付约束

## 影响

改写全部条款为编号规则，正文不再附来源行。C-010 要求接入项目采用 Concord 方法论（技术栈仍中立），concord check 纳入写作政策检查，属消费者兼容变更，契约与验收见 documentation-quality；C-012 禁止 docs 记录实施过程与点名已删除内容；新增 C-014 性能预算、测量方法与缓存一致性。经未参与方案的 GPT-6 Astra reviewer 只读审查三轮，全部阻断意见已按建议修订，结论 PASS。

## 来源

- `docs/feature/documentation-quality/README.md`
- `docs/engineering/concord-self-hosting/performance.md`
- `docs/feature/local-sdlc/README.md`
