import { createConsumer } from './consumer.js';
import { writeProjectConfig } from './support.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDocument } from '../../src/model/index.js';

export const useCasePath = 'docs/feature/sample/use-case/inspect.md';
export const researchPath = 'docs/research/sample/README.md';
export function fixture() {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
  mkdirSync(join(root, 'docs/feature/sample/use-case'), { recursive: true });
  mkdirSync(join(root, 'docs/research/sample'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/sample/README.md'), renderDocument({ format: 'concord.document/v1', kind: 'feature', id: 'sample', title: 'Sample' }, '# Sample\n\nA local sample.\n'));
  writeFileSync(join(root, useCasePath), renderDocument({ format: 'concord.document/v1', kind: 'use-case', id: 'inspect', title: 'Inspect', feature: 'docs/feature/sample/README.md' }, '# Inspect\n\n## Flow {#flow}\n\n1. Read the parser-sentinel source. {#read}\n2. Return the facts. {#return}\n'));
  writeFileSync(join(root, researchPath), renderDocument({ format: 'concord.document/v1', kind: 'research', id: 'sample-research', title: 'Research', createdAt: '2026-10-29', sources: [] }, '# Research\n\nLocal source bytes.\n'));
  return root;
}
