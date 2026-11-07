// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { packageRoot } from '../installation/index.ts';
import { compiledInstallation } from '../installation/index.ts';

const Receipt = Schema.fromJsonString(Schema.Struct({ input: Schema.String, digest: Schema.String }));
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Executable integrity must not allocate a whole runtime inside a bounded editor. */
function fileHash(path: string): string {
  const descriptor = openSync(path, 'r');
  try {
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) return digest.digest('hex');
      digest.update(buffer.subarray(0, count));
    }
  } finally { closeSync(descriptor); }
}
let prepared: string | undefined;

/** Source-only tool preparation is lazy and never writes into the checkout. */
export function compilerSupervisorPath(): string {
  if (compiledInstallation) return process.execPath;
  if (prepared !== undefined) return prepared;
  const bun = process.versions.bun === undefined ? 'bun' : process.execPath;
  const version = readFileSync(join(packageRoot, '.bun-version'), 'utf8').trim();
  if (execFileSync(bun, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim() !== version) throw new Error(`Compiler supervisor requires Bun ${version}`);
  const compiler = execFileSync(bun, ['--no-env-file', '--config=/dev/null', '-p', 'process.execPath'], { encoding: 'utf8', timeout: 10_000 }).trim();
  const compilerDigest = fileHash(compiler);
  const inputs = ['src/entry/compiler/main.ts', 'src/base/process/typescript-supervisor.ts', 'src/base/process/typescript-supervisor-build.ts', 'bun.lock', '.bun-version'];
  const identity = hash(JSON.stringify([packageRoot, process.platform, process.arch, compilerDigest, ...inputs.map(file => [file, hash(readFileSync(join(packageRoot, file)))])]));
  const directory = join(homedir(), '.cache', 'concord', 'compiler-supervisor', identity);
  const executable = join(directory, 'compiler');
  const receipt = join(directory, 'receipt.json');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(executable)) try {
    const record = Schema.decodeUnknownSync(Receipt)(readFileSync(receipt, 'utf8'));
    if (record.input === identity && record.digest === fileHash(executable)) return prepared = executable;
  } catch { /* rebuild an incomplete or damaged cache artifact */ }
  const temporary = join(directory, `.${randomUUID()}`);
  try {
    execFileSync(bun, ['build', '--no-env-file', '--config=/dev/null', '--compile', '--bytecode', '--format=esm', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--no-compile-autoload-tsconfig', '--compile-autoload-package-json', `--define=CONCORD_COMPILER_PACKAGE_ROOT=${JSON.stringify(packageRoot)}`, '--outfile', temporary, 'src/entry/compiler/main.ts'], { cwd: packageRoot, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 });
    chmodSync(temporary, 0o755);
    const manifest = JSON.stringify({ input: identity, digest: fileHash(temporary) });
    renameSync(temporary, executable);
    writeFileSync(`${temporary}.json`, manifest, { mode: 0o600 });
    renameSync(`${temporary}.json`, receipt);
    return prepared = executable;
  } finally { rmSync(temporary, { force: true }); rmSync(`${temporary}.json`, { force: true }); }
}
