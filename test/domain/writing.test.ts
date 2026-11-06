import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { checkWriting } from "../../src/domain/writing/index.ts";

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('writing scan refuses edits to inputs and directory membership during a real repository read', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-race-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    for (const kind of ['content', 'policy', 'membership'] as const) {
      writeFileSync(join(root, 'docs/writing.md'), '# Rules\n');
      writeFileSync(join(root, 'docs/race.md'), 'Before.');
      class EditingRepository extends LocalRepository {
        armed = true;
        override read(path: string): string | undefined {
          const value = super.read(path);
          if (this.armed && path === 'docs/race.md') {
            this.armed = false;
            if (kind === 'content') writeFileSync(join(root, path), 'After.');
            if (kind === 'policy') writeFileSync(join(root, 'docs/writing.md'), '{}');
            if (kind === 'membership') writeFileSync(join(root, 'docs/added.md'), 'New file.');
          }
          return value;
        }
      }
      const repo = new EditingRepository(root, { dryRun: true });
      try { assert.throws(() => checkWriting(repo), { code: 'SourceChanged' }); }
      finally { repo.close(); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
