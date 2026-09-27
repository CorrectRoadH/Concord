# Decision record

本裁决选择 Node 文件发布协调。共享读取与缓存边界见 [总架构](../../architecture.md)。

## Decision

Selected: [single-lock](plans/single-lock/README.md)

## Rationale

Use one Node filesystem publication lease and short snapshots. Coordination retains durable running, finalizing, and quarantined runner states. The cache is disposable. The selected plan excludes old-version migration and requires release validation.

## Rejected Options

Retaining flock preserves an external lock-program dependency and duplicate lifetime complexity. A database coordinator would violate the cache-only role and is outside this design.

## Residual Risks

Short snapshots coordinate processes; a busy caller retries from a fresh plan. PID reuse can conservatively block dead-owner recovery. Unknown runner cleanup requires explicit operator investigation; parent death alone is insufficient.

Local filesystem primitives do not certify network storage or all power-loss behavior. Windows execution and old-version interoperability are outside this release.
