---
format: concord.document/v1
id: portable-release-coordination
title: Portable runtime and release coordination
createdAt: 2026-09-21T09:55:09.912Z
kind: design
alternatives:
  - retain-flock
  - portable-lock
constitutionRefs:
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
decision:
  selected: retain-flock
  reason: Preserve proven flock and journal semantics while Homebrew supplies the portable runtime dependency.
  at: 2026-09-21T09:59:47.531Z
  targets:
    - docs/feature/cross-platform-release/README.md
---

# Portable runtime and release coordination

Before comparing plans, read `docs/constitution.md` and record every applicable real clause anchor in this Design's `constitutionRefs` metadata.

## Problem

Describe the decision to make and why comparing alternatives is necessary.

## Core Mental Model

Define the concepts and evaluation criteria shared by every candidate.

## Scope and Tradeoffs

State the decision's boundaries and the tradeoffs the comparison must resolve.

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
Each candidate in plans/ is a self-contained feature design package.
The decision is recorded only by `concord design decide`; writing prose does not select a candidate.

Goals and Limits use stable G/L-numbered H2 entries. Every candidate README must respond to all entries in its Goals and Limits tables, including failures and pending evidence. Run `concord design check <id>` before deciding. `concord design format <id>` only normalizes supported layout; it never supplies a choice or evidence. Record the exact selected slug and link in DECISION, explain accepted Goal gaps, then decide. All selected-plan Limits must be satisfied.
