# Your title

Before comparing plans, read `docs/constitution.md` and link each applicable clause or paragraph ID next to the sentence that relies on it.

## Problem

Describe the decision to make and why comparing alternatives is necessary.

## Core Mental Model

Define the concepts and evaluation criteria shared by every candidate.

## Scope and Tradeoffs

State the decision's boundaries and the tradeoffs the comparison must address.

## Entry Points

- [Goals](GOALS.md): requirements and comparison criteria.
- [Limits](LIMITS.md): constraints shared by every candidate.
- [Cases](CASES.md): neutral scenarios for the comparison.
- [Decision](DECISION.md): explanatory evidence.
Each directory in `plans/` is one self-contained candidate; its directory name is the candidate slug.
The `Selected:` line in DECISION is the decision; prose elsewhere does not select a candidate.

Goals and Limits use stable G/L-numbered H2 entries. Every candidate README must respond to all entries in its Goals and Limits tables, including failures and pending evidence.

Run `concord check` before deciding; it validates the Goals and Limits tables but does not supply a choice or evidence.

Explain accepted Goal gaps in DECISION, then run `concord design decide`, which validates every candidate and writes the `Selected:` line. All selected-plan Limits must be satisfied. Once decided, write the rules that still apply into the Feature pages and link this Design's README or DECISION as rationale.
