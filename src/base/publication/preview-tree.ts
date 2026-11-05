import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, sep } from 'node:path';
import { Effect, Schema } from 'effect';
import { sourceInstallation, builtAssetRoot } from '../installation/index.js';
import { ConcordError, failure } from '../../model/index.js';
const MiB = 1024 * 1024;

interface DirectoryIdentity { path: string; dev: number; ino: number; }
function directoryChain(path: string): DirectoryIdentity[] {
  const chain: DirectoryIdentity[] = []; let current = parse(path).root;
  for (const part of [ '', ...path.slice(current.length).split(sep).filter(Boolean) ]) {
    if(part) current=join(current,part);
    const stat=lstatSync(current);
    if(stat.isSymbolicLink()||!stat.isDirectory()) throw new ConcordError('PreviewUnsafeOutput',`Output ancestor is not a real directory: ${current}`);
    chain.push({path:current,dev:stat.dev,ino:stat.ino});
  }
  return chain;
}
function verifyDirectories(chain: readonly DirectoryIdentity[]): void {
  for(const item of chain){const stat=lstatSync(item.path);if(stat.isSymbolicLink()||!stat.isDirectory()||stat.dev!==item.dev||stat.ino!==item.ino) throw new ConcordError('PreviewOutputChanged',`Output directory changed: ${item.path}`);}
}
function staticFiles(): Map<string, Buffer> {
  const root=builtAssetRoot('preview'); const files=new Map<string,Buffer>(); let total=0;
  function visit(relative: string): void {
    for(const name of readdirSync(join(root,relative))){const path=join(relative,name), absolute=join(root,path), stat=lstatSync(absolute);
      if(stat.isSymbolicLink()) throw new ConcordError('PreviewAssetsInvalid','Static assets cannot be symbolic links.');
      if(stat.isDirectory())visit(path);
      else if(stat.isFile()){
        if(stat.size>10*MiB||total+stat.size>64*MiB||files.size>=255)throw new ConcordError('PreviewAssetsInvalid','Static assets exceed publication budgets.');
        const bytes=readFileSync(absolute);total+=bytes.length;files.set(path,bytes);
      }else throw new ConcordError('PreviewAssetsInvalid','Unexpected static asset type.');
    }
  }
  visit('');if(!files.has('index.html'))throw new ConcordError('PreviewAssetsInvalid','Installed preview is missing index.html.');return files;
}
function publishNow(out: string, data: string, chain: DirectoryIdentity[], assets: Map<string, Buffer>): void {
  const files=new Map(assets); files.set('changes.json',Buffer.from(data));
  verifyDirectories(chain);
  try { mkdirSync(out,{mode:0o700}); } catch(cause) {
    if(Schema.is(Schema.Struct({code:Schema.Literal('EEXIST')}))(cause))throw new ConcordError('PreviewOutputExists',`Output already exists: ${out}`);
    throw cause;
  }
  try {
    chain.push(...directoryChain(out).slice(-1));
    for(const [path,bytes] of [...files].sort(([a],[b])=>Number(a==='index.html')-Number(b==='index.html')||a.localeCompare(b))){
      verifyDirectories(chain);const destination=join(out,path), parent=dirname(destination);
      if(parent!==out){
        let current=out;
        for(const segment of parent.slice(out.length+1).split(sep)){current=join(current,segment);if(!chain.some(item=>item.path===current)){mkdirSync(current,{mode:0o700});chain.push(...directoryChain(current).slice(-1));}}
      }
      verifyDirectories(chain);writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
    }
    verifyDirectories(chain);
  }catch(cause){throw new ConcordError('PreviewPublicationFailed',`Incomplete output preserved at ${out}: ${cause instanceof Error?cause.message:String(cause)}`,{output:out});}
}

export const inspectExportAncestors = Effect.fn('Publication.inspectExportAncestors')((out: string, root: string, privatePaths: readonly string[]) => Effect.try({
  try: () => {
    if (out === root || privatePaths.some(path => out === path || out.startsWith(path + sep))) throw new ConcordError('PreviewUnsafeOutput', 'Output cannot be the repository root or Git-private storage.');
    return directoryChain(dirname(out));
  }, catch: failure,
}));
export const publishExport = Effect.fn('Publication.publishExport')(function*(out: string, data: string, chain: DirectoryIdentity[]) {
  const files = sourceInstallation
    ? yield* Effect.tryPromise({ try: async () => (await import('../installation/index.js')).sourcePreviewFiles(), catch: failure })
    : yield* Effect.try({ try: staticFiles, catch: failure });
  return yield* Effect.try({ try: () => publishNow(out, data, chain, files), catch: failure });
});
