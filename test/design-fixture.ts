import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Authored documents, not a replica of the validator. */
export function authorDesignFixture(root: string, id: string, alternatives: readonly string[], selected: string): void {
  const base = join(root, 'docs/design', id);
  writeFileSync(join(base, 'GOALS.md'), '# Goals\n\n## G1: Local queries\n\nQueries return results without contacting a server. Source: consumer requirements.\n');
  writeFileSync(join(base, 'LIMITS.md'), '# Limits\n\n## L1: Offline\n\nNo network calls are permitted. Verify in an isolated consumer.\n');
  for (const plan of alternatives) writeFileSync(join(base, 'plans', plan, 'README.md'), `# ${plan}

## Problem

Provide local query storage.

## Core Mental Model

The consumer owns one local store.

## Scope

Local reads and writes.

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-offline) | ${plan === selected ? 'satisfied' : 'not-satisfied'} | ${plan === selected ? 'All data stays on disk' : 'Requires a remote service'} | Design analysis of the storage boundary; no execution claimed |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-local-queries) | satisfied | Index local records | Design argument: reads use the local index |

## Entry Points

The README defines this complete candidate.
`);
  writeFileSync(join(base, 'DECISION.md'), `# Decision

## Decision

Selected: [${selected}](plans/${selected}/README.md)

## Rationale

The selected candidate can query the local store while respecting the offline boundary.

## Rejected Options

Other candidates require a remote service and violate L1.

## Residual Risks

Disk capacity remains a deployment concern. This decision is design analysis, not execution evidence.
`);
}
