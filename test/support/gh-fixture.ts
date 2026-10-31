import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The external gh boundary, shared by source and built command tests. */
export function writeGhFixture(bin: string, scenarioFile: string, callsFile: string): void {
mkdirSync(bin);
// JavaScript consumer fixture models the gh executable boundary only.
writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs=require('node:fs');
const scenarioPath=${JSON.stringify(scenarioFile)};
const callsPath=${JSON.stringify(callsFile)};
const mode=JSON.parse(fs.readFileSync(scenarioPath,'utf8'));
const args=process.argv.slice(2);
let input='';
const finish=()=>{
fs.appendFileSync(callsPath,JSON.stringify({args,stdin:input,env:{GH_DEBUG:process.env.GH_DEBUG,GH_REPO:process.env.GH_REPO,GH_PROMPT_DISABLED:process.env.GH_PROMPT_DISABLED}})+'\\n');
if(args[0]==='--version'){console.log('gh version 2.98.0 (fixture)');return;}
if(args[1]==='--help'){console.log('--hostname --method --include --input');return;}
const method=args[args.indexOf('--method')+1];const path=args.at(-1);
const isWrite=method!=='GET';
let body;let status=200;
if(mode.oversize&&!isWrite){process.stdout.write('x'.repeat(3*1024*1024));return;}
if(path==='repos/example/product')body={id:mode.repositoryId||42,full_name:'example/product'};
else if(path.includes('/issues?')){
const params=new URL('https://api.github.com/'+path).searchParams;
body=mode.pages?Array.from({length:100},(_,i)=>({...mode.issue,number:(Number(params.get('page'))-1)*100+i+1,html_url:'https://github.com/example/product/issues/'+((Number(params.get('page'))-1)*100+i+1)})):(mode.list||[]).filter(i=>i.state===params.get('state'));
}else if(!isWrite)body=mode.issue;
else {
const payload=JSON.parse(input||'{}');
if(mode.reject){status=mode.reject;body={message:'rejected'};}
else if(method==='PATCH'){mode.issue={...mode.issue,...payload};body=mode.issue;}
else if(path.endsWith('/labels')&&method==='POST'){mode.issue.labels=[...new Set([...mode.issue.labels.map(i=>i.name),...payload.labels])].map(name=>({name}));body=mode.issue.labels;}
else if(method==='DELETE'){const label=decodeURIComponent(path.split('/').at(-1));mode.issue.labels=mode.issue.labels.filter(i=>i.name!==label);body=mode.issue.labels;}
else if(path.endsWith('/comments'))body={id:1,body:payload.body};
else{body={...mode.issue,number:99,html_url:'https://github.com/example/product/issues/99',...payload};mode.list=[...(mode.list||[]),body];}
fs.writeFileSync(scenarioPath,JSON.stringify(mode));
if(mode.hangWrite){setInterval(()=>{},1000);return;}
if(mode.signalWrite){process.kill(process.pid,'SIGTERM');return;}
if(mode.invalidWrite){console.log('invalid response');return;}
}
process.stdout.write('HTTP/2 '+status+' OK\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(body));process.exitCode=status>=400?1:0;
};
if(args.includes('--input')){process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',finish);}else finish();
`, { mode: 0o755 });
}
