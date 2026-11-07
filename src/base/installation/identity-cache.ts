// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { Schema } from 'effect';
import { makeRuntimeEnvironment, runtimeCacheHome, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from './location.ts';
import { ConcordError, digest } from '../../model/index.ts';

interface IdentityTree { readonly root: string; readonly prefix: string; readonly accept: (name: string, relative: string) => boolean; readonly linkRoot?: string }
const Hash = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const Record = Schema.Struct({ format: Schema.Literal('concord.installation-identity/v1'), root: Schema.String, fingerprint: Hash, identity: Hash, checksum: Hash });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Record), { onExcessProperty: 'error' });

function inspect(trees: readonly IdentityTree[]) {
  const links: string[][] = [];
  const metadata: unknown[] = [], files: { path: string; relative: string }[] = [];
  const visit = (path: string, prefix: string, accept: IdentityTree['accept'], linkRoot?: string, ancestors: readonly string[] = []): void => {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (linkRoot === undefined || isAbsolute(target)) throw new ConcordError('UnsafePath', 'Installation link escapes its dependency tree');
      let resolved: string;
      try { resolved = realpathSync(path); }
      catch { throw new ConcordError('UnsafePath', 'Installation link is dangling or cyclic'); }
      const boundary = relative(linkRoot, resolved);
      if (boundary === '..' || boundary.startsWith('../') || isAbsolute(boundary)) throw new ConcordError('UnsafePath', 'Installation link escapes its dependency tree');
      metadata.push([prefix, 'link', target]);
      links.push([`${prefix}@link`, target]);
      visit(resolved, prefix, accept, linkRoot, ancestors);
      return;
    }
    if (ancestors.includes(path)) throw new ConcordError('UnsafePath', 'Installation contains a directory cycle');
    const identity = [String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];
    if (stat.isDirectory()) {
      const entries = readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      metadata.push([prefix, 'directory', identity, entries.map(entry => entry.name)]);
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory() || entry.isSymbolicLink() || accept(entry.name, relative)) visit(join(path, entry.name), relative, accept, linkRoot, [...ancestors, path]);
      }
    } else {
      metadata.push([prefix, stat.isFile() ? 'file' : 'special', identity]);
      if (!stat.isFile()) throw new ConcordError('UnsafePath', 'Installation contains a special file');
      if (stat.isFile() && accept(path.split('/').at(-1)!, prefix)) files.push({ path, relative: prefix });
    }
  };
  for (const tree of trees) visit(tree.root, tree.prefix, tree.accept, tree.linkRoot);
  return { fingerprint: digest(JSON.stringify(metadata)), files, links };
}
function cachePath(root: string, runtime: RuntimeEnvironmentSnapshot): string {
  const directory = join(runtimeCacheHome(runtime), 'concord', 'installation-identities');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw new Error('Unsafe installation identity cache');
  return join(directory, `${digest(root).slice(7)}.json`);
}
const checksum = (root: string, fingerprint: string, identity: string) => digest(JSON.stringify({ root, fingerprint, identity }));
function read(path: string, root: string, fingerprint: string): string | undefined {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) return;
    const record = decode(readFileSync(fd, 'utf8'));
    if (record.root === root && record.fingerprint === fingerprint && record.checksum === checksum(root, fingerprint, record.identity)) return record.identity;
  } finally { closeSync(fd); }
}

/** Every hit repeats metadata and directory membership verification. */
export function installationIdentity(root: string, trees: readonly IdentityTree[], prefix: readonly string[][] = [], runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})): string {
  const before = inspect(trees);
  const fingerprint = digest(JSON.stringify([prefix, before.fingerprint]));
  let path: string | undefined;
  try { path = cachePath(root, runtime); const cached = read(path, root, fingerprint); if (cached) return cached; }
  catch { /* An unreadable or damaged cache only costs a full content digest. */ }
  const files = before.files.map(file => [file.relative, digest(readFileSync(file.path))]);
  if (inspect(trees).fingerprint !== before.fingerprint) throw new ConcordError('InstallationChanged', 'Installation changed while its content identity was being verified; retry');
  const identity = digest(JSON.stringify([...prefix, ...before.links, ...files]));
  if (path) {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ format: 'concord.installation-identity/v1', root, fingerprint, identity, checksum: checksum(root, fingerprint, identity) }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
    } catch { /* Identity remains authoritative when cache publication fails. */ }
    finally { try { unlinkSync(temporary); } catch { /* renamed or never created */ } }
  }
  return identity;
}
