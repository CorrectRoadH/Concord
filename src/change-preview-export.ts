// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/review-pull-request.md
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { ConcordError, failure } from './shared.js';
import { decodeChangePreview, PREVIEW_DATA_LIMIT, PREVIEW_ENTRY_LIMIT, type ChangePreviewEntry, type PreviewSide } from './change-preview.js';
import { previewGit, previewGitEnvironment } from './change-preview-git.js';

const MiB = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const readText = (bytes: Buffer): string | undefined => { try { return bytes.includes(0) ? undefined : utf8.decode(bytes); } catch { return undefined; } };
const checked = <A>(f: () => A) => Effect.try({ try: f, catch: failure });
const RawSchema = Schema.Struct({
  oldMode: Schema.Literals(['000000','100644','100755','120000','160000']),
  newMode: Schema.Literals(['000000','100644','100755','120000','160000']),
  oldOid: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u)),
  newOid: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u)),
  status: Schema.String.check(Schema.isPattern(/^(?:[ADMT]|R\d{1,3})$/u)),
});
interface RawEntry { path: string; previousPath?: string; status: ChangePreviewEntry['status']; before: PreviewSide | null; after: PreviewSide | null; }
function parseRaw(bytes: Buffer, maximum = PREVIEW_ENTRY_LIMIT): RawEntry[] {
  let text: string;
  try { text = utf8.decode(bytes); } catch { throw new ConcordError('GitPathEncodingUnsupported','Git paths must be valid UTF-8.'); }
  if (text && !text.endsWith('\0')) throw new ConcordError('PreviewGitInvalid','Incomplete Git inventory.');
  const parts = text.split('\0'); parts.pop(); const entries: RawEntry[] = [];
  for (let i = 0; i < parts.length;) {
    const header = parts[i++]!;
    if (!header.startsWith(':')) throw new ConcordError('PreviewGitInvalid','Invalid Git raw header.');
    const [oldMode,newMode,oldOid,newOid,status] = header.slice(1).split(' ');
    const row = Schema.decodeUnknownSync(RawSchema)({oldMode,newMode,oldOid,newOid,status});
    const first = parts[i++]; const renamed = row.status.startsWith('R'); const path = renamed ? parts[i++] : first;
    if (!first || !path) throw new ConcordError('PreviewGitInvalid','Missing Git path.');
    entries.push({ path, ...(renamed?{previousPath:first}:{}), status:row.status[0] as RawEntry['status'],
      before:row.oldMode==='000000'?null:{oid:row.oldOid,mode:row.oldMode}, after:row.newMode==='000000'?null:{oid:row.newOid,mode:row.newMode} });
    if(entries.length>maximum) throw new ConcordError('PreviewBudgetExceeded','Too many changed files.');
  }
  return entries;
}
const quoted = (path: string) => /[\s"\\]/u.test(path) ? JSON.stringify(path) : path;
function labelPatch(patch: string, entry: RawEntry): string {
  if (!patch) return '';
  const oldPath = quoted('a/' + (entry.previousPath ?? entry.path)), newPath = quoted('b/' + entry.path);
  const mode = entry.status === 'A' ? `new file mode ${entry.after!.mode}\n` : entry.status === 'D' ? `deleted file mode ${entry.before!.mode}\n` : '';
  return patch.replace(/^diff --git[^\n]*\n/u,`diff --git ${oldPath} ${newPath}\n${mode}`)
    .replace(/^--- [^\n]*\n/mu,`--- ${entry.before?oldPath:'/dev/null'}\n`).replace(/^\+\+\+ [^\n]*\n/mu,`+++ ${entry.after?newPath:'/dev/null'}\n`);
}
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
  const root=fileURLToPath(new URL('./preview/',import.meta.url)); const files=new Map<string,Buffer>(); let total=0;
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
function publish(out: string, data: string, chain: DirectoryIdentity[]): void {
  const files=staticFiles(); files.set('changes.json',Buffer.from(data));
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
export interface ChangePreviewOptions { root: string; base: string; head?: string; baseLabel?: string; out: string; }
export const exportChangePreview = Effect.fn('preview.export')(function*(options: ChangePreviewOptions) {
  return yield* Effect.scoped(Effect.gen(function*(){
    const environment=previewGitEnvironment(); const cwd=resolve(options.root);
    const sourceText = (args: readonly string[]) => previewGit(cwd,args,environment,MiB).pipe(Effect.map(bytes=>bytes.toString('utf8').replace(/\r?\n$/u,'')));
    const root=yield* sourceText(['rev-parse','--show-toplevel']);
    const gitDir=yield* sourceText(['rev-parse','--absolute-git-dir']);
    const common=yield* sourceText(['rev-parse','--path-format=absolute','--git-common-dir']);
    if((yield* sourceText(['rev-parse','--is-shallow-repository']))!=='false')return yield* Effect.fail(new ConcordError('PreviewShallowRepository','Fetch complete history before exporting.'));
    const base=yield* sourceText(['rev-parse','--verify','--end-of-options',options.base+'^{commit}']);
    const head=yield* sourceText(['rev-parse','--verify','--end-of-options',(options.head??'HEAD')+'^{commit}']);
    const objectFormat=yield* sourceText(['rev-parse','--show-object-format']);
    if(objectFormat!=='sha1'&&objectFormat!=='sha256')return yield* Effect.fail(new ConcordError('PreviewGitInvalid','Unsupported Git object format.'));
    const objects=yield* sourceText(['rev-parse','--path-format=absolute','--git-path','objects']);
    const out=resolve(options.out);
    const chain=yield* checked(()=>{
      if(out===root||[gitDir,common,join(root,'.git')].some(path=>out===path||out.startsWith(path+sep)))throw new ConcordError('PreviewUnsafeOutput','Output cannot be the repository root or Git-private storage.');
      return directoryChain(dirname(out));
    });
    const temporary=yield* Effect.acquireRelease(checked(()=>mkdtempSync(join(tmpdir(),'concord-preview-'))),path=>Effect.sync(()=>rmSync(path,{recursive:true,force:true})));
    const bare=join(temporary,'objects.git');
    yield* previewGit(temporary,['init','--bare','--quiet','--template=','--object-format='+objectFormat,bare],environment);
    const isolated={...environment,GIT_ALTERNATE_OBJECT_DIRECTORIES:JSON.stringify(objects)};
    const git=(args: readonly string[], limit=2*MiB,input?:string)=>previewGit(bare,args,isolated,limit,input);
    const mergeBases=(yield* git(['merge-base','--all',base,head])).toString('utf8').trim().split('\n');
    if(mergeBases.length!==1||!mergeBases[0])return yield* Effect.fail(new ConcordError('PreviewMergeBaseAmbiguous','The comparison requires exactly one best common ancestor.'));
    const mergeBase=mergeBases[0];
    const empty=(yield* git(['hash-object','-w','--stdin'],128,'')).toString('utf8').trim();
    const inventoryArgs=['diff','--raw','-z','--no-abbrev','--no-ext-diff','--no-textconv','--ignore-submodules=none','--submodule=short'];
    const inventory=yield* git([...inventoryArgs,'--no-renames',mergeBase,head,'--']).pipe(Effect.flatMap(bytes=>checked(()=>parseRaw(bytes,PREVIEW_ENTRY_LIMIT*2))));
    const oids=[...new Set(inventory.flatMap(entry=>[entry.before,entry.after]).filter(side=>side!==null&&side.mode!=='160000').map(side=>side!.oid))];
    if(oids.length){
      const sizes=yield* git(['cat-file','--batch-check=%(objecttype) %(objectsize)'],256*1024,oids.join('\n')+'\n');
      yield* checked(()=>{
        const lines=sizes.toString('ascii').trim().split('\n');let total=0;
        if(lines.length!==oids.length)throw new ConcordError('PreviewGitInvalid','Incomplete object size inventory.');
        for(const line of lines){const match=/^blob ([0-9]+)$/u.exec(line);const size=Number(match?.[1]);
          if(!match||!Number.isSafeInteger(size))throw new ConcordError('PreviewGitFailed','Required blob is missing or not a blob.');
          total+=size;if(size>4*MiB||total>64*MiB)throw new ConcordError('PreviewBudgetExceeded','Object budget exceeded before rename detection.');
        }
      });
    }
    const raw=yield* git([...inventoryArgs,'--find-renames=50%','-l2000',mergeBase,head,'--']).pipe(Effect.flatMap(bytes=>checked(()=>parseRaw(bytes))));
    const entries: ChangePreviewEntry[]=[];let readBytes=0,dataBytes=0;
    for(const entry of raw){
      const readSide=Effect.fn('preview.blob')(function*(side:PreviewSide|null){
        if(!side||side.mode==='160000')return null;
        const size=Number((yield* git(['cat-file','-s',side.oid],64)).toString('ascii').trim());
        if(!Number.isSafeInteger(size)||size<0||size>4*MiB||readBytes+size>64*MiB)return yield* Effect.fail(new ConcordError('PreviewBudgetExceeded','Git objects exceed the 4 MiB per-object or 64 MiB total budget.'));
        readBytes+=size;const value=yield* git(['cat-file','blob',side.oid],4*MiB);
        if(value.length!==size)return yield* Effect.fail(new ConcordError('PreviewGitInvalid','Git blob size changed.'));
        return {text:readText(value),size};
      });
      const before=yield* readSide(entry.before),after=yield* readSide(entry.after);
      const binary=before?.text===undefined&&before!==null||after?.text===undefined&&after!==null;
      const gitlink=entry.before?.mode==='160000'||entry.after?.mode==='160000';
      let patch='';
      if(!binary&&!gitlink){const diff=yield* git(['diff','--no-ext-diff','--no-textconv','--no-color','--unified=4',entry.before?.oid??empty,entry.after?.oid??empty,'--']);patch=yield* checked(()=>labelPatch(utf8.decode(diff),entry));}
      const markdown=(side:PreviewSide|null,path:string,value:{text:string|undefined;size:number}|null)=>{
        if(binary||!side||side.mode==='120000'||side.mode==='160000'||!value||!/\.(md|markdown)$/iu.test(path))return undefined;
        if(value.size>MiB)throw new ConcordError('PreviewBudgetExceeded','Markdown exceeds the 1 MiB per-side budget.');return value.text;
      };
      const result=yield* checked(()=>{
        const beforeMarkdown=markdown(entry.before,entry.previousPath??entry.path,before),afterMarkdown=markdown(entry.after,entry.path,after);
        return {...entry,patch,binary,...(beforeMarkdown===undefined?{}:{beforeMarkdown}),...(afterMarkdown===undefined?{}:{afterMarkdown})};
      });
      dataBytes+=Buffer.byteLength(JSON.stringify(result))+1;if(dataBytes>PREVIEW_DATA_LIMIT)return yield* Effect.fail(new ConcordError('PreviewBudgetExceeded','Preview JSON exceeds 8 MiB.'));entries.push(result);
    }
    const data=yield* checked(()=>decodeChangePreview({format:'concord.change-preview/v1',comparison:{base,head,mergeBase,baseLabel:options.baseLabel??options.base},entries}));
    yield* checked(()=>publish(out,JSON.stringify(data),chain));
    return {operation:'view-export' as const,output:out,comparison:data.comparison,files:entries.length};
  })).pipe(Effect.timeout('120 seconds'),Effect.mapError(cause=>cause instanceof ConcordError?cause:new ConcordError('PreviewExportFailed',String(cause))));
});
