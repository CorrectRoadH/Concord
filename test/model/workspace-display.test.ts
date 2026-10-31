// @concord-file
// @concord-verifies docs/feature/herdr-panel/architecture.md#渲染
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { workspaceDisplay, featureUseCases, implementationGroups, relatedTests, contractIdentities } from '../../src/model/workspace-display/index.js';
import * as webDisplay from '../../web/lib/workspace-display.js';
import { projectDocPages } from '../../web/lib/project-docs.js';
import { panelSnapshot, feature, featurePath, useCasePath, supportPath } from '../support/panel-fixture.js';

test('Web and panel derive the same fixed generation, preserving ordered relation groups', () => Effect.runSync(Effect.sync(() => {
  const model = workspaceDisplay(panelSnapshot);
  assert.deepEqual(model, webDisplay.workspaceDisplay(panelSnapshot));
  assert.deepEqual(model.categories.find(category => category.kind === 'feature')?.documents, [feature]);
  assert.deepEqual(model.features[0]?.useCases.map(item => item.path), [useCasePath]);
  assert.deepEqual(featureUseCases(panelSnapshot, feature), webDisplay.featureUseCases(panelSnapshot, feature));
  assert.deepEqual([...contractIdentities(panelSnapshot, feature)], [featurePath, useCasePath, supportPath]);
  const groups = implementationGroups(panelSnapshot, feature);
  assert.deepEqual(groups.map(group => [group.owner.path, group.codes.map(code => code.id)]), [[featurePath, ['read-body']], [useCasePath, ['read-body']]]);
  assert.deepEqual(groups, webDisplay.implementationGroups(panelSnapshot, feature));
  assert.equal(relatedTests(panelSnapshot, feature).length, 2);
  assert.deepEqual(relatedTests(panelSnapshot, feature), webDisplay.relatedTests(panelSnapshot, feature));
  assert.deepEqual(model.documents[0]?.testGroups.map(group => group.cases.map(item => item.file)), [['test/reader.test.ts'], ['test/use-case.test.ts']]);
  assert.deepEqual(model.pages, projectDocPages(panelSnapshot));
  assert.deepEqual(model.pages.map(page => page.path), ['docs/README.md', 'docs/architecture.md']);
})));

test('extraction preserves Web relation variants rather than broadening matches', () => Effect.runSync(Effect.sync(() => {
  const child = panelSnapshot.documents[1]!;
  assert.equal(child.metadata.kind, 'use-case');
  if (child.metadata.kind !== 'use-case') return;
  const snapshot = { ...panelSnapshot, documents: [feature, { ...child, metadata: { ...child.metadata, feature: feature.metadata.id } }] };
  assert.equal(featureUseCases(snapshot, feature).length, 1);
  assert.equal(implementationGroups(snapshot, feature).length, 1);
  assert.deepEqual([...contractIdentities(snapshot, feature)], [featurePath, supportPath]);
})));
