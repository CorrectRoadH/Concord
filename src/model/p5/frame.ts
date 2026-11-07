// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#p5-图解
// @concord-implements docs/feature/herdr-mod/cli.md#渲染一页
import type { P5Bundle } from './protocol.ts';
import type { WorkbenchTheme } from './theme.ts';

export const p5ContentPolicy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline' blob: data:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const p5Sandbox = 'allow-scripts allow-downloads';
const scriptText = (value: string) => value.replace(/<\/script/giu, '<\\/script');
const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The same runtime and capability policy serve HTTP frames and standalone pages. */
export function p5FrameDocument(runtime: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${attribute(p5ContentPolicy)}"><style>html{background:var(--concord-bg,white);color:var(--concord-fg,#171717)}body{margin:8px;font-family:var(--concord-font,system-ui);min-height:84px}canvas{display:block;max-width:100%;height:auto}</style></head><body><script>${scriptText(runtime)}</script></body></html>`;
}

export function p5StandaloneDocument(runtime: string, bundle: P5Bundle, variables: WorkbenchTheme): string {
  const payload = JSON.stringify({ bundle, variables }).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${attribute(p5ContentPolicy.replace("frame-src 'none'", "frame-src 'self' about:"))}"><title>Concord p5</title><style>body{margin:0}iframe{width:100%;height:100vh;border:0}#error{white-space:pre-wrap}</style></head><body><pre id="error" role="alert"></pre><iframe title="p5 图解" sandbox="${p5Sandbox}" allow="camera 'none'; microphone 'none'; geolocation 'none'" referrerpolicy="no-referrer"></iframe><script>const payload=${payload};const frame=document.querySelector('iframe');addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!=='null')return;const message=event.data;if(!message||typeof message!=='object')return;if(message.kind==='ready'){frame.contentWindow.postMessage({kind:'theme',variables:payload.variables},'*');frame.contentWindow.postMessage({kind:'start',bundle:payload.bundle},'*');}if(message.kind==='error'&&typeof message.message==='string')document.getElementById('error').textContent=message.message.slice(0,4096);});document.addEventListener('visibilitychange',()=>frame.contentWindow.postMessage({kind:document.hidden?'pause':'resume'},'*'));frame.srcdoc=${JSON.stringify(p5FrameDocument(runtime)).replaceAll('<', '\\u003c')};</script></body></html>`;
}
