# Retain descriptor-backed flock

Keep the external `flock` program and command-long coordination protocol. This preserves lock mechanics but does not meet the requirement to remove system program dependencies.

## Goals

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [G1](../../GOALS.md#g1-portable-runtime) | not-satisfied | Retains the dependency and original scope. | Existing implementation; rejected because the Goals remain unmet. |
| [G2](../../GOALS.md#g2-short-ownership) | not-satisfied | Retains the dependency and original scope. | Existing implementation; rejected because the Goals remain unmet. |
| [G3](../../GOALS.md#g3-simple-coordination) | not-satisfied | Retains the dependency and original scope. | Existing implementation; rejected because the Goals remain unmet. |

## Limits

| Requirement | Status | Mechanism or gap | Evidence |
|---|---|---|---|
| [L1](../../LIMITS.md#l1-preserve-authorization) | satisfied | Current contract retained. | Existing implementation; rejected because the Goals remain unmet. |
| [L2](../../LIMITS.md#l2-recover-safely) | satisfied | Current contract retained. | Existing implementation; rejected because the Goals remain unmet. |
| [L3](../../LIMITS.md#l3-preserve-execution-evidence) | satisfied | Current contract retained. | Existing implementation; rejected because the Goals remain unmet. |
| [L4](../../LIMITS.md#l4-no-new-fact-store) | satisfied | Current contract retained. | Existing implementation; rejected because the Goals remain unmet. |
