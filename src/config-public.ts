/**
 * Dependency-free type surface for statically authored concord.config.ts files.
 * Keep this structural declaration independent from Effect so a consumer does
 * not need Concord's own compiler lib settings merely to type-check its config.
 */
export type Runner =
  | { readonly kind: 'node-test'; readonly sourceFiles: readonly string[]; readonly timeoutMs: number }
  | { readonly kind: 'command'; readonly argv: readonly [string, ...string[]]; readonly sourceFiles: readonly string[]; readonly timeoutMs: number };

export interface MemorySource {
  readonly name: string;
  readonly provider: 'local-files';
  readonly path: string;
  readonly access: 'read-only' | 'read-write';
  readonly defaultWrite?: boolean;
}

export type FeedbackConnection =
  | { readonly id: string; readonly provider: 'github'; readonly credentialEnv: string; readonly owner: string; readonly repo: string; readonly repositoryId?: string }
  | { readonly id: string; readonly provider: 'linear'; readonly credentialEnv: string; readonly team: string; readonly organizationId?: string; readonly teamId?: string };

export interface ProjectConfig {
  readonly format: 'concord.project/v1';
  readonly projectId: string;
  readonly testRoots: readonly string[];
  readonly sourceRoots?: readonly string[];
  readonly runner: Runner;
  readonly feedbackConnections?: readonly FeedbackConnection[];
  readonly projectTypes?: readonly ('library' | 'cli')[];
  readonly documentDefaults?: {
    readonly featurePages: readonly ('library' | 'cli' | 'architecture' | 'lifecycle' | 'use-case')[];
    readonly roadmapPages: readonly ('library' | 'cli' | 'architecture' | 'lifecycle' | 'use-case')[];
    readonly designPages: readonly ('library' | 'cli' | 'architecture' | 'lifecycle' | 'use-case')[];
  };
  readonly constitution?: { readonly path: 'docs/constitution.md' };
  readonly memorySources?: readonly [MemorySource, ...MemorySource[]];
}
