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
  readonly languageServers?: readonly LanguageServer[];
  /** Repository-relative files or directory subtrees excluded from automatic code/test discovery; no globs. */
  readonly sourceIgnore?: readonly string[];
  readonly p5?: { readonly libraries: readonly string[] };
  readonly runner: Runner;
  readonly docsWork?: {
    readonly checks?: Readonly<Record<string, {
      readonly argv: readonly [string, ...string[]];
      readonly timeoutMs?: number;
    }>>;
    readonly finalizer?: {
      readonly argv: readonly [string, ...string[]];
      readonly timeoutMs?: number;
    };
    readonly sharedPaths?: readonly string[];
  };
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

/** Declarative profiles select only built-in lexical and range policies. */
export interface LanguageServer {
  readonly id: string;
  readonly languageId: string;
  readonly extensions: readonly [string, ...string[]];
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly initializationOptions: Readonly<Record<string, unknown>>;
  readonly implementationFiles: readonly [string, ...string[]];
  readonly sourceFiles: readonly string[];
  readonly environment?: readonly ('PATH' | 'LANG' | 'LC_ALL' | 'TZ' | 'TMPDIR' | 'SYSTEMROOT')[];
  readonly budgets: Partial<Readonly<Record<'totalMs' | 'requestMs' | 'outputBytes' | 'messageBytes' | 'messages' | 'requests' | 'concurrency' | 'files' | 'symbols' | 'nodes' | 'depth', number>>>;
  readonly profile: {
    readonly version: string;
    readonly serverVersion: string;
    readonly commentPrefixes: readonly [('#' | '//' | '--' | ';'), ...('#' | '//' | '--' | ';')[]];
    readonly declarationKinds: readonly [number, ...number[]];
    readonly symbolShape: 'document-symbol';
    readonly decorators: 'none' | 'at-line';
    readonly leadingComments: boolean;
    readonly readiness: { readonly kind: 'none' } | { readonly kind: 'progress'; readonly token: string };
    readonly positionEncodings: readonly [('utf-16' | 'utf-8' | 'utf-32'), ...('utf-16' | 'utf-8' | 'utf-32')[]];
  };
}
