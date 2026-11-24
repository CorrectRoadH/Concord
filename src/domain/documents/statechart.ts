// @concord-file
// @concord-implements docs/feature/local-sdlc/format.md#状态图块
// @concord-implements docs/feature/documentation-quality/cli.md#状态图
import { posix } from 'node:path';
import { snapshotBytes, snapshotMetadata } from '../../base/sources/index.ts';
import {
  canonicalPath, ConcordError, digest, inRepositorySnapshot, packagePageKind, parseStatechart, statechartBlocks,
  statechartDigest, statechartFinding, statechartOwner, statechartPaths,
  type Repository, type StatechartBlock, type StatechartFiles, type StatechartPath, type StatechartResolution, type StatechartWatch,
} from '../../model/index.ts';

const restricted = (path: string): boolean => path.split('/').some(part => part.startsWith('.') || part === 'node_modules');
const under = (path: string, directory: string): boolean => path.startsWith(`${directory}/`);
const unreadable = (cause: unknown): boolean => cause instanceof Error && 'code' in cause
  && ['UnsafePath', 'InvalidFile', 'ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO'].includes(String(cause.code));

function targetPath(document: string, source: string): string | undefined {
  if (!source.startsWith('./') && !source.startsWith('../') || /[\\?#\0\r\n]/u.test(source)) return undefined;
  const path = posix.normalize(posix.join(posix.dirname(document), source)).replace(/\/$/u, '');
  if (restricted(path)) return undefined;
  return path;
}

function targetExists(repo: Repository, path: string, kind: 'file' | 'directory'): boolean {
  try {
    // Specifying a directory through a symlink is unsafe even if its destination is in the repository.
    const stat = snapshotMetadata(repo, path);
    return stat === undefined && kind === 'directory' && repo.inspect === undefined
      ? repo.files(path).some(file => under(file, path))
      : stat?.[kind] === true && !stat.symbolicLink;
  } catch (cause) {
    if (unreadable(cause)) return false;
    throw cause;
  }
}

function readBytes(repo: Repository, path: string): Uint8Array | undefined {
  try { return targetExists(repo, path, 'file') ? snapshotBytes(repo, path) : undefined; }
  catch (cause) {
    if (unreadable(cause)) return undefined;
    throw cause;
  }
}

export function isStatechartPage(repo: Repository, path: string): boolean {
  const owner = statechartOwner(path);
  if (owner === undefined || !targetExists(repo, owner, 'file')) return false;
  const root = posix.dirname(owner);
  const directory = `${root}/statechart`;
  const paths = new Set<string>();
  if (targetExists(repo, directory, 'directory')) paths.add(`${directory}/`);
  if (targetExists(repo, `${directory}/README.md`, 'file')) paths.add(`${directory}/README.md`);
  return packagePageKind(owner, path, paths) === 'statechart';
}

function statechartPages(repo: Repository, paths: Iterable<string>): Iterable<string> {
  return [...paths].filter(path => (path.endsWith('/statechart.md') || path.includes('/statechart/')) && isStatechartPage(repo, path));
}

export function statechartOutputRoots(repo: Repository, paths: Iterable<string> = repo.files('docs')): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const path of statechartPages(repo, paths)) {
    const source = repo.read(path);
    if (source === undefined) continue;
    for (const block of statechartBlocks(path, source)) {
      const parsed = parseStatechart(block);
      if ('error' in parsed) continue;
      const out = targetPath(path, parsed.options.out);
      if (out !== undefined && targetExists(repo, out, 'directory')) roots.add(out);
    }
  }
  return roots;
}

export function outsideStatechartOutputs(path: string, outputs: ReadonlySet<string>): boolean {
  for (const out of outputs) if (under(path, out)) return false;
  return true;
}

function modelModules(repo: Repository, directory: string): readonly string[] {
  if (directory !== '.' && !targetExists(repo, directory, 'directory')) return [];
  const siblings = repo.directoryMembers?.(directory) ?? (directory === '.' ? repo.rootFiles?.() ?? [] : repo.files(directory));
  return siblings.filter(path => posix.dirname(path) === directory && path.endsWith('.tla') && !restricted(path) && !targetExists(repo, path, 'directory'));
}

/** Missing and unsafe dependencies still get watch paths so repairs invalidate the projection. */
export function statechartProjectionInputs(repo: Repository, docs: readonly string[]): {
  readonly watch: StatechartWatch;
  readonly inputs: readonly (readonly [string, string | boolean | null])[];
} {
  const outputs = statechartOutputRoots(repo, docs);
  const files = new Set<string>();
  const modelDirectories = new Set<string>();
  const reportDirectories = new Set<string>();
  for (const document of statechartPages(repo, docs)) {
    if (!outsideStatechartOutputs(document, outputs)) continue;
    const source = repo.read(document);
    if (source === undefined) continue;
    for (const block of statechartBlocks(document, source)) {
      const parsed = parseStatechart(block);
      if ('error' in parsed) continue;
      for (const attribute of statechartPaths) {
        const target = parsed.options[attribute];
        const path = target === undefined ? undefined : targetPath(document, target);
        if (path === undefined) continue;
        if (attribute === 'out') {
          reportDirectories.add(path);
          files.add(`${path}/chart.mmd`);
          files.add(`${path}/report.md`);
        } else {
          files.add(path);
          if (attribute === 'spec') modelDirectories.add(posix.dirname(path));
        }
      }
    }
  }
  const watch = { files: [...files].sort(), modelDirectories: [...modelDirectories].sort() };
  for (const directory of modelDirectories) for (const path of modelModules(repo, directory)) files.add(path);
  return {
    watch,
    inputs: [
      ...[...files].sort().map(path => { const bytes = readBytes(repo, path); return [path, bytes === undefined ? null : digest(bytes)] as const; }),
      ...[...reportDirectories].sort().map(path => [path, targetExists(repo, path, 'directory')] as const),
    ],
  };
}

export function readStatechartSource(repo: Repository, path: string): { path: string; body: string; digest: string } | undefined {
  canonicalPath(path);
  if (restricted(path) || !/\.(?:tla|cfg|ts|js|mjs)$/u.test(path)) return undefined;
  const pages = repo.files('docs');
  const outputs = statechartOutputRoots(repo, pages);
  for (const document of statechartPages(repo, pages)) {
    if (!outsideStatechartOutputs(document, outputs)) continue;
    const source = repo.read(document);
    if (source === undefined) continue;
    for (const block of statechartBlocks(document, source)) {
      const parsed = parseStatechart(block);
      if ('error' in parsed) continue;
      const { spec, config, view } = parsed.options;
      if (![spec, config, view].some(target => target !== undefined && targetPath(document, target) === path)) continue;
      const bytes = readBytes(repo, path);
      if (bytes !== undefined) return { path, body: Buffer.from(bytes).toString('utf8'), digest: digest(bytes) };
      return undefined;
    }
  }
  return undefined;
}

type StatechartInputs = (StatechartFiles & { readonly stale: boolean }) | Extract<StatechartResolution, { error: unknown }>;

export function inspectStatechart(repo: Repository, block: StatechartBlock): {
  readonly result: StatechartInputs;
  readonly findings: readonly ReturnType<typeof statechartFinding>[];
} {
  const failed = (error: ReturnType<typeof statechartFinding>) => ({ result: { error }, findings: [error] });
  const missing = (attribute: StatechartPath, target: string) => failed(statechartFinding(
    block, 'StatechartFileNotFound', `Statechart ${attribute} is unavailable: ${target}`, { attribute, target },
  ));
  return inRepositorySnapshot(repo, () => {
    const parsed = parseStatechart(block);
    if ('error' in parsed) return failed(parsed.error);
    if (!isStatechartPage(repo, block.document)) return failed(statechartFinding(block, 'InvalidStatechartPosition', 'Statechart blocks require a statechart page'));
    const options = parsed.options;
    const paths = new Map<StatechartPath, string>();
    const model = new Map<string, Uint8Array>();
    for (const attribute of statechartPaths) {
      const target = options[attribute];
      if (target === undefined) continue;
      const path = targetPath(block.document, target);
      if (path === undefined) return missing(attribute, target);
      if (attribute === 'out') {
        if (!targetExists(repo, path, 'directory')) return missing(attribute, target);
      } else {
        const bytes = readBytes(repo, path);
        if (bytes === undefined) return missing(attribute, target);
        model.set(path, bytes);
      }
      paths.set(attribute, path);
    }
    const view = paths.get('view');
    const files: StatechartFiles = { spec: paths.get('spec')!, config: paths.get('config')!, out: paths.get('out')!, ...(view === undefined ? {} : { view }) };
    const directory = posix.dirname(files.spec);
    for (const path of modelModules(repo, directory)) {
      if (model.has(path) || under(path, files.out)) continue;
      const bytes = readBytes(repo, path);
      if (bytes === undefined) {
        return missing('spec', path);
      }
      model.set(path, bytes);
    }
    const actual = statechartDigest(model);
    const stale = actual !== options.digest;
    const reportPath = `${files.out}/report.md`;
    const missingReport = statechartFinding(block, 'StatechartReportNotFound', `Statechart report is unavailable: ${reportPath}`, { target: reportPath });
    const report = targetExists(repo, reportPath, 'file');
    const findings = [
      ...(report ? [] : [missingReport]),
      ...(stale ? [statechartFinding(block, 'StatechartStale', `Statechart result is older than its model: ${options.spec}`, { expected: options.digest, actual })] : []),
    ];
    // Check only needs directory membership and model bytes; reading the artifacts is deferred to previews.
    return { result: { ...files, stale }, findings };
  });
}

export function loadStatechartArtifacts(repo: Repository, result: StatechartInputs): StatechartResolution {
  if ('error' in result) return result;
  const read = (target: string) => {
    const bytes = readBytes(repo, target);
    return bytes === undefined ? { error: `Statechart artifact is unavailable: ${target}` } : { text: Buffer.from(bytes).toString('utf8') };
  };
  const chartPath = `${result.out}/chart.mmd`;
  let chart;
  try { if (snapshotMetadata(repo, chartPath) !== undefined) chart = read(chartPath); }
  catch (cause) {
    if (!unreadable(cause)) throw cause;
    chart = { error: `Statechart artifact is unavailable: ${chartPath}` };
  }
  const report = read(`${result.out}/report.md`);
  return { ...result, ...(chart === undefined ? {} : { chart }), report };
}
