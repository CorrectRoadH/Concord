---
format: concord.document/v1
id: load-compatible-repository-profile
title: 加载中立项目治理接入
createdAt: 2026-09-13T11:00:38.089Z
kind: use-case
feature: docs/feature/local-sdlc/README.md
---

# 加载中立项目治理接入

## 场景

维护者将软件项目按 Concord 的套件、源码身份、证据要求和安全写入规范接入，在使用原生执行能力时验证实际 host 与锁定 engine，而静态查询不执行项目代码。

## 主流程

1. 显式声明 `concord.repository/v2`：suite ID/root、historyPath、版本化 policy 及可选 host。
2. 静态 list/trace/Web 从 suite 源码注释派生关系；不读取 Nx 或产品分类，不加载 host。
3. 只有请求 inventory 或原生证据能力时加载当前 v2 host，验证 root、caseIdentity、实际 engine 和所需能力。
4. 原生结果必须唯一绑定真实声明、契约、候选与配置；Concord 统一核验可靠性事实和当前 Problem epoch。
5. 已采用原生证明要求的 Problem 不接受 command 降级。旧格式通过显式离线迁移保留原件与历史，不能补摘要变成当前证明。

## 验收

- root 或 engine 身份错误时，原生能力在业务执行前具名失败。
- host 缺少当前协议、所需能力或配置损坏时返回具体诊断。
- 加载即失败的 host 不妨碍 help、静态关系与 Web。
- 非 Nx、非 e2e 目录且没有 executor/lanes 字段的软件项目能够接入。
- helper、声明名称、源码集合、契约、配置或 adapter 身份变化使旧 proof 失效。
- command 收据不能绕过原生可靠性下限；真实原生验收须单独执行，不能以 help/fake-host 测试代替。

## 权威契约

[高级测试治理](../../../repository-profile.md)拥有当前配置、source v4/projection v3、证据和迁移边界；[中立治理设计](../../../design/neutral-project-governance/README.md)记录裁决。
