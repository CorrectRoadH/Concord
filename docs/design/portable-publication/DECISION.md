# Decision record

本页解释历史选择。共享读取和 HawDB 的后续当前契约见 [总架构](../../architecture.md)，不以本页历史风险描述覆盖当前功能验收。

## Decision

Selected: [single-lock](plans/single-lock/README.md)

## Rationale

Use one Node filesystem publication lease and short snapshots. The user explicitly excludes old-version migration and requires SQLite to remain a disposable cache. Independent Herdr design_grill, GPT-6 Astra, accepted the final contract on 2026-09-22 after adding persistent running/finalizing/quarantined runner states. Its conditions are incorporated in the selected plan; release validation remains mandatory.

## Rejected Options

Retaining flock preserves the external helper dependency and duplicate lifetime complexity. A SQLite coordinator would violate the requested cache-only role and is not part of this design.

## Residual Risks

Short snapshots serialize across processes, and a busy caller retries from a fresh plan. PID reuse can conservatively block dead-owner recovery. Unknown runner cleanup requires explicit operator investigation; parent death alone is insufficient. Local filesystem primitives do not certify network storage or all power-loss behavior. Windows execution and old-version interoperability are outside this release.
