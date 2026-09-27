# Source provenance

Concord originates in NiceEval's private repository maintenance tools and engineering contracts.

- Source: NiceEval `packages/repo-tools/src/`
- Source revision: `e1c66d31115208ceaae2f5bd4d730a7abf67048d`
- Original concepts: Feature / Use Case contracts, source-owned trace relations, Problem / Decision / Insight lifecycle, managed mutation, and evidence-backed review.

Concord is an independent local project. It does not include NiceEval product data, credentials, deployment configuration, or its formal E2E evidence implementation.

The extraction map in `docs/provenance.md` identifies reused logic and deliberately replaced host boundaries.

The Web workbench bundles third-party libraries; their notices are generated in `dist/web/.vite/license.md`. Bundled Noto Sans SC font files are provided by Fontsource under the SIL Open Font License 1.1; the full font notice is included in `dist/web/FONT-LICENSE.txt`.

The isolated sketch runtime bundles p5.js 2.3.4 under LGPL-2.1, with the license in `dist/web/P5-LICENSE.txt` and dependency notices in `dist/web/p5-runtime.js.LEGAL.txt`. Optional project libraries p5.sound 0.4.1 (LGPL-2.1) and p5.brush 2.2.3 (MIT) retain their distributed JavaScript and adjacent license files in `dist/web/p5-libraries/`. Their source packages and versions are fixed by the package lockfiles; sketches load these assets locally.

The native cache engine embeds [HawDB](https://github.com/nowledge-co/hawdb), Apache-2.0, at revision `1e9f76428be6649a18a6f99d75b0ccfef16bf545`. The bridge dependency graph is pinned in `native/hawdb/Cargo.lock`; engine and dependency license material accompanies the target artifacts in `dist/native/`. HawDB is not a source of Concord contracts, Memory, Issue, or test evidence.
