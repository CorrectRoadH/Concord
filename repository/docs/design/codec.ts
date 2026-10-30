import { designPlanName } from 'concord-sdlc/document-layout';
import { decodeDocumentSource, designState } from 'concord-sdlc/document-codec';
import type { DesignSchema } from 'concord-sdlc/model';
import type { RepoRef } from '../trace/ref.js';
import { DesignInputInvalid } from './errors.js';
import type { DesignDecisionState } from './model.js';

export interface DecodedDesignReadme {
  readonly metadata: typeof DesignSchema.Type;
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly alternatives: readonly string[];
  readonly body: string;
  readonly state: DesignDecisionState;
  readonly decides: readonly string[];
}

export function decodeDesignReadme(path: string, source: string, entries: ReadonlyMap<string, string> = new Map(), decision = ''): DecodedDesignReadme {
  try {
    const record = decodeDocumentSource(path, source);
    if (record?.metadata.kind !== 'design') throw new Error('Expected a Design README');
    const state = designState(decision, path.slice(0, -'/README.md'.length), entries);
    const metadata = { ...record.metadata, alternatives: [...entries.keys()],
      ...(state.selected === undefined ? {} : { decision: { selected: state.selected, reason: state.rationale || 'Selected in DECISION', targets: [] } }),
      ...(state.deferred === undefined ? {} : { deferral: { reason: state.deferred } }),
    };
    return { metadata, id: metadata.id, title: metadata.title, createdAt: metadata.createdAt ?? '', alternatives: metadata.alternatives, body: record.body,
      state: state.selected === undefined ? state.deferred === undefined ? { _tag: 'undecided' } : { _tag: 'deferred', reason: state.deferred } : { _tag: 'decided', selectedPlan: entries.get(state.selected)! }, decides: [] };
  } catch (cause) { throw new DesignInputInvalid({ source: path, message: cause instanceof Error ? cause.message : String(cause) }); }
}

/** The README is prose only; the publication owner writes DECISION separately. */
export function encodeDecidedDesignReadme(decoded: DecodedDesignReadme, selectedPlan: RepoRef, body: string, _reason?: string): string {
  if (!decoded.alternatives.includes(designPlanName(selectedPlan))) throw new DesignInputInvalid({ source: decoded.id, message: 'Selected Plan is not a direct candidate' });
  return body.endsWith('\n') ? body : `${body}\n`;
}
