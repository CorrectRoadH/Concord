// @concord-file
// @concord-implements docs/engineering/testing/use-case/extend-fixtures.md
import { initialize } from './operations.ts';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join } from 'node:path';
import { after, before } from 'node:test';
import { LocalRepository } from "./repository.ts";


let temporary: string | undefined;
let template: string | undefined;
const finalizers = new Set<() => Promise<void>>();
const retained = new Set<string>();

/** Resource owners release their service before this file's template tree is removed. */
export function beforeConsumerCleanup(finalizer: () => Promise<void>): void { finalizers.add(finalizer); }
export function retainConsumer(root: string): void { retained.add(root); }

/** One initialized consumer per test process, cloned with its real Git metadata. */
export function createConsumer(): string {
  if (template === undefined) {
    temporary = mkdtempSync(join(tmpdir(), 'concord-consumers-'));
    template = join(temporary, 'template'); mkdirSync(template);
    execFileSync('git', ['init', '-q', template]);
    const repo = new LocalRepository(template, { initialize: true });
    try { initialize(repo); } finally { repo.close(); }
  }
  const root = mkdtempSync(join(temporary!, 'consumer-')); cpSync(template, root, { recursive: true });
  return root;
}

export function withConsumer(run: (repo: LocalRepository, root: string) => void): void {
  const root = createConsumer(); const repo = new LocalRepository(root);
  try { run(repo, root); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

after(async () => {
  const results = await Promise.allSettled([...finalizers].map(finalizer => finalizer()));
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  const roots = [...retained].filter(existsSync);
  if (failures.length || roots.length) throw new AggregateError(failures, `Consumer cleanup unconfirmed; retained roots: ${roots.join(', ')}`);
  if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
});
before(() => { const root = createConsumer(); rmSync(root, { recursive: true, force: true }); });
