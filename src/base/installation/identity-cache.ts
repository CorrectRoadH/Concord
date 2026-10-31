// @concord-file
// @concord-implements docs/architecture.md#基础服务
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { ConcordError, digest } from '../../model/index.js';

interface IdentityTree { readonly root: string; readonly prefix: string; readonly accept: (name: string, relative: string) => boolean }
const Hash = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const Record = Schema.Struct({ format: Schema.Literal('concord.installation-identity/v1'), root: Schema.String, fingerprint: Hash, identity: Hash, checksum: Hash });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Record), { onExcessProperty: 'error' });

function inspect(trees: readonly IdentityTree[]) {
  const metadata: unknown[] = [], files: { path: string; relative: string }[] = [];
  const visit = (path: string, prefix: string, accept: IdentityTree['accept']): void => {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', 'Installation contains a symbolic link');
    const identity = [String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];
    if (stat.isDirectory()) {
      const entries = readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      metadata.push([prefix, 'directory', identity, entries.map(entry => entry.name)]);
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new ConcordError('UnsafePath', 'Installation contains a symbolic link');
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory() || accept(entry.name, relative)) visit(join(path, entry.name), relative, accept);
      }
    } else {
      metadata.push([prefix, stat.isFile() ? 'file' : 'special', identity]);
      if (stat.isFile() && accept(path.split('/').at(-1)!, prefix)) files.push({ path, relative: prefix });
    }
  };
  for (const tree of trees) visit(tree.root, tree.prefix, tree.accept);
  return { fingerprint: digest(JSON.stringify(metadata)), files };
}
function cachePath(root: string): string {
  const directory = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'installation-identities');
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
export function installationIdentity(root: string, trees: readonly IdentityTree[], prefix: readonly string[][] = []): string {
  const before = inspect(trees);
  let path: string | undefined;
  try { path = cachePath(root); const cached = read(path, root, before.fingerprint); if (cached) return cached; }
  catch { /* An unreadable or damaged cache only costs a full content digest. */ }
  const files = before.files.map(file => [file.relative, digest(readFileSync(file.path))]);
  if (inspect(trees).fingerprint !== before.fingerprint) throw new ConcordError('InstallationChanged', 'Installation changed while its content identity was being verified; retry');
  const identity = digest(JSON.stringify([...prefix, ...files]));
  if (path) {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ format: 'concord.installation-identity/v1', root, fingerprint: before.fingerprint, identity, checksum: checksum(root, before.fingerprint, identity) }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
    } catch { /* Identity remains authoritative when cache publication fails. */ }
    finally { try { unlinkSync(temporary); } catch { /* renamed or never created */ } }
  }
  return identity;
}
