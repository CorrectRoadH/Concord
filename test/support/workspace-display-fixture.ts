import type { WorkspaceProjectionSnapshot, WorkspaceDocument, AnnotatedCase } from '../../src/model/index.ts';
export const featurePath = 'docs/feature/reader/README.md';
export const useCasePath = 'docs/feature/reader/use-case/read.md';
export const supportPath = 'docs/feature/reader/architecture.md';
export const feature: WorkspaceDocument = { path: featurePath, digest: 'feature-1', metadata: { format: 'concord.document/v1', kind: 'feature', id: 'reader', title: '阅读 Spec' } };
export const useCase: WorkspaceDocument = { path: useCasePath, digest: 'use-case-1', metadata: { format: 'concord.document/v1', kind: 'use-case', id: 'read', title: '阅读正文', feature: featurePath } };
export const testCase: AnnotatedCase = { id: 'neref_00000000000000000000000000000001', name: 'reads body', file: 'test/reader.test.ts', line: 8, markerEndLine: 12, contract: `${supportPath}#阅读`, contractKind: 'feature', issues: [], status: 'active', framework: 'node:test', skipped: false };
export const displaySnapshot: WorkspaceProjectionSnapshot = {
  conceptCatalogs: [],
  complete: true, root: '/worktree', project: {}, configDigest: 'config-1', documents: [feature, useCase], feedback: [],
  pages: [{ path: featurePath, digest: feature.digest, documentPath: featurePath }, { path: supportPath, digest: 'support-1', documentPath: featurePath }, { path: 'docs/architecture.md', digest: 'root-1', derivedTitle: '总体架构' }, { path: 'docs/README.md', digest: 'index-1' }],
  cases: [testCase, { ...testCase, id: 'neref_00000000000000000000000000000002', file: 'test/use-case.test.ts', contract: useCasePath }],
  codes: [{ id: 'read-body', file: 'src/reader.ts', line: 2, endLine: 5, scope: 'node', symbol: 'readBody', contracts: [`${supportPath}#阅读`, useCasePath] }],
  edges: [], findings: [], sources: [{ path: 'src/reader.ts', digest: 'source-1' }, { path: testCase.file, digest: 'test-1' }, { path: 'test/use-case.test.ts', digest: 'test-2' }], evidenceIds: [], templates: [], cache: {}, diagnostics: {},
};
export const panelBody = '# 阅读 Spec\n\nSpec 是工作约定。\n\n1. 打开正文\n2. 查看 `readBody`\n\n[正文](use-case/read.md)\n\n| 项目 | 状态 |\n| --- | --- |\n| 读取 | 可用 |\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```p5\nfunction setup() { createCanvas(100, 100); }\n```';
