import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { decodeChangePreview, PREVIEW_DATA_LIMIT, type ChangePreview } from '../../src/change-preview';
import { DiffReading } from '../pages/git/diff-reading';
import { fileTree, type TreeNode } from '../pages/git/model';
import 'react-diff-view/style/index.css';
import '@fontsource-variable/noto-sans-sc/wght.css';
import './style.css';

function Tree({ node, selected, select }: {node: TreeNode; selected?: string; select(path:string):void}) {
  return <ul>{[...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(child=><li key={child.path}>
    {child.entry && <button type="button" aria-label={child.path} aria-current={selected===child.path?'true':undefined} onClick={()=>select(child.path)}><span>{child.name}</span><small>{child.entry.index}</small></button>}
    {child.children.size>0 && <details open><summary>{child.name}</summary><Tree node={child} selected={selected} select={select}/></details>}
  </li>)}</ul>;
}
function Review({data}:{data:ChangePreview}) {
  const [hash,setHash]=useState(location.hash);
  useEffect(()=>{const changed=()=>setHash(location.hash);addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  const params=new URLSearchParams(hash.replace(/^#/u,''));
  const entry=data.entries.find(item=>item.path===params.get('path'))??data.entries[0];
  const view=params.get('view')==='split'?'split':'unified';
  const content=params.get('content')??'diff';
  const change=(key:string,value:string)=>{const next=new URLSearchParams(params);next.set(key,value);if(key==='path')next.set('content','diff');location.hash=next.toString();};
  const tree=fileTree(data.entries.map(item=>({path:item.path,previousPath:item.previousPath,index:item.status,worktree:' ',untracked:false,conflicted:false})));
  const markdown=content==='before'?entry?.beforeMarkdown:content==='after'?entry?.afterMarkdown:undefined;
  return <div className="preview-shell"><header><strong className="brand">Concord</strong><span>PR 变更 · 只读</span><span className="target">{data.comparison.baseLabel}</span><span>{data.entries.length} 个文件</span></header>
    <div className="comparison"><span>base <code>{data.comparison.base}</code></span><span>head <code>{data.comparison.head}</code></span><span>merge-base <code>{data.comparison.mergeBase}</code></span></div>
    <div className="review"><nav aria-label="变更文件"><Tree node={tree} selected={entry?.path} select={path=>change('path',path)}/></nav><main>
      {!entry?<p className="empty">没有变更</p>:<><div className="file-heading"><h1>{entry.path}</h1><span>{entry.status}{entry.previousPath?` · 从 ${entry.previousPath}`:''}</span></div>
        <div className="controls"><button aria-pressed={content==='diff'} onClick={()=>change('content','diff')}>差异</button>{entry.beforeMarkdown!==undefined&&<button aria-pressed={content==='before'} onClick={()=>change('content','before')}>变更前</button>}{entry.afterMarkdown!==undefined&&<button aria-pressed={content==='after'} onClick={()=>change('content','after')}>变更后</button>}
          <span className="spacer"/><button aria-pressed={view==='unified'} onClick={()=>change('view','unified')}>统一</button><button aria-pressed={view==='split'} onClick={()=>change('view','split')}>分栏</button></div>
        <div className="object-sides"><span>前：{entry.before?`${entry.before.mode} · ${entry.before.oid}`:'不存在'}</span><span>后：{entry.after?`${entry.after.mode} · ${entry.after.oid}`:'不存在'}</span></div>
        {markdown!==undefined?<article className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url=>/^(https?:|mailto:)/iu.test(url)?url:''} components={{img:()=>null,a:({href,children})=>href?<a href={href} rel="noreferrer noopener">{children}</a>:<span>{children}</span>}}>{markdown}</ReactMarkdown></article>
          :<section data-git-diff><DiffReading key={`${entry.path}:${view}`} value={{...entry,truncated:false}} view={view} position={0} remember={()=>undefined}/></section>}
      </>}
    </main></div></div>;
}
function App(){
  const [data,setData]=useState<ChangePreview>();const [error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    void (async()=>{
      const response=await fetch(new URL('changes.json',location.href),{signal:abort.signal});
      if(!response.ok)throw new Error(`无法读取变更数据（HTTP ${response.status}）`);
      const reader=response.body?.getReader();if(!reader)throw new Error('变更数据为空');
      const chunks:Uint8Array[]=[];let size=0;
      try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>PREVIEW_DATA_LIMIT)throw new Error('变更数据超过 8 MiB');chunks.push(value.value);}}
      finally{await reader.cancel();reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const value=decodeChangePreview(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      if(!abort.signal.aborted)setData(value);
    })().catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>abort.abort();
  },[]);
  if(error)return <main className="empty"><h1>无法打开 PR 变更</h1><p role="alert">{error}</p><button onClick={()=>location.reload()}>重试</button></main>;
  return data?<Review data={data}/>:<p className="empty" role="status">正在读取变更…</p>;
}
createRoot(document.getElementById('root')!).render(<App/>);
