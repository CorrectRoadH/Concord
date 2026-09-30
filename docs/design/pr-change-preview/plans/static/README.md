# 静态导出

## Problem

通过只读预览审阅固定 PR 提交，同时避免向公网提供本地工作台的写入和执行入口。

## Core Mental Model

Concord 读取冻结 Git 对象，输出一个静态目录；浏览器只读取严格解码的差异数据。消费者拥有 PR 身份、Git 获取和托管。

## Scope

提供文件差异、Markdown 前后正文、身份提示与深链接。不复制完整工作台操作，不执行消费者配置或文档代码。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-公共阅读不授予本地能力) | satisfied | 独立静态入口没有 mutation API | [架构](architecture.md#产物与生命周期)的权限分离设计 |
| [L2](../../LIMITS.md#l2-产物绑定明确输入) | satisfied | 固定提交和唯一共同祖先，失败不回退 | [比较契约](architecture.md#比较契约) |
| [L3](../../LIMITS.md#l3-独占输出并保留未知文件) | satisfied | 受信父目录、排他创建、失败保留输出，私有临时资源回收 | [生命周期](architecture.md#产物与生命周期)的设计约束；不声明执行通过 |
| [L4](../../LIMITS.md#l4-可安装且有界) | satisfied | 固定 tarball、随包资源与分层硬预算 | [验收](architecture.md#验收边界)声明独立安装验证；不替代执行证据 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-正确识别-pr-的改动) | satisfied | merge-base 到 head 的 Git 对象差异 | 比较契约与 C1、C2 |
| [G2](../../GOALS.md#g2-直接阅读文件和文档) | satisfied | 文件树、diff、前后正文和 hash 选择 | PR 用例与 C3、C4 |
| [G3](../../GOALS.md#g3-消费者接入简洁) | partial | 静态托管简洁，消费者仍须取得可信 PR 身份并固定工具包 | NiceEval 接入与 C5 |

## Entry Points

- [结构、边界与验收](architecture.md)
