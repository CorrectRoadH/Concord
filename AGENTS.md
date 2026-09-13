# Concord development

Concord is a standalone local SDLC CLI extracted from NiceEval's repository workflows.
Read `docs/architecture.md` for the adopted contract and `docs/provenance.md` for extraction boundaries.
Do not depend on a NiceEval checkout, workspace package, provider credential, deployment service, or global installation.

Keep contracts, executable test definitions, and engineering memories in their own owners. Derive reverse relations; do not store a second registry. Do not claim command receipts prove native test coverage or NiceEval formal E2E reliability.

Effect dependencies stay on the exact pinned revision. Read the installed `effect/AGENTS.md` before using its APIs. Use strict Schema decoding at untrusted boundaries and named failures.

Maintain implementation, tests, and build scripts in strict TypeScript with Effect for execution and side effects. Do not add hand-maintained JavaScript scripts or bypass type checking. JavaScript build output and explicit JavaScript-consumer compatibility fixtures are distinct from maintained implementation sources.

Test the built and packed public CLI in isolated Git consumers using `pnpm check`. No paid model calls, external mutations, production operations, publishing, or pushing without explicit user authorization.

Workers are not alone in this repository. Preserve other changes, stay within assigned paths, and do not commit unless assigned. Do not use built-in subagents. Herdr delegation follows the user's global guide.
