import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { checkWriting } from "../../src/domain/writing/index.ts";

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('writing scan refuses edits to inputs and directory membership during a real repository read', () => Effect.runPromise(Effect.sync(() => {
  const root = createConsumer();
  try {
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
