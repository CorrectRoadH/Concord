# 裁决

## Decision

Selected: [ts-only](plans/ts-only/README.md)

## Rationale

用户禁止 legacy；独立只读挑战最终 PASS。错误优先级、拒绝识别及 prepared-init 例外条件已落实为契约与验收定义，旧兼容设计被本裁决替代。

采用 ts-only，metadata 中的 design decision 为唯一裁决来源。用户禁止 legacy；原 onboarding-contracts 的兼容性部分已被本设计替代。

G1: ts-only 明确普通运行时只接受 concord.config.ts，旧 concord.json 和 dual 配置返回具名迁移错误；原文支持该目标。

G2: ts-only 要求拒绝静态旧现场不得创建、删除、chmod 或改写配置、journal、锁、事务目标及临时文件。本次格式迁移不复验完整 gate 与 packed consumers；原记录证明的范围不扩大。

## Rejected Options

runtime-compatibility 继续解码 JSON 配置、使用旧 owner 或恢复缺当前配置绑定的事务，会保留多个运行时授权模型，并违反用户明确的无 legacy 约束；拒绝此方案。历史数据交给显式离线迁移，当前运行时只检测并具名拒绝旧格式。

## Residual Risks

完整 pnpm check 和 packed consumers 验收不得绕过；JSON-only、dual、子目录发现、workspace、JS 绕过类型调用、旧 owner 发布，以及当前 prepared-init/config-before-after/source 恢复的验收范围保持不变。本次格式迁移不复验这些历史记录；独立挑战 PASS 是设计与验收定义，不代替实现证据。
