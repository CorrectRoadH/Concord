import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';
import { LocalRepository } from "./repository.js";
import { initialize } from "../../src/app/index.js";

let temporary: string | undefined;
let template: string | undefined;

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

after(() => { if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true }); });
before(() => { const root = createConsumer(); rmSync(root, { recursive: true, force: true }); });
