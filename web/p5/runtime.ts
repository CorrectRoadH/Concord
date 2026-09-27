// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/embed-p5-sketch.md
import P5 from 'p5';
import { Effect, Schema } from 'effect';
import { P5ControlSchema } from '../../src/p5-contract';

const globals = window as unknown as { p5: typeof P5; ConcordSketch?: { default?: (p: P5) => void } };
globals.p5 = P5;
let instance: P5 | undefined;
let started = false;
let paused = false;
let wantsLoop = true;
let suspend: (() => void) | undefined;
let resume: (() => void) | undefined;
let failed = false;
const send = (value: unknown) => parent.postMessage(value, '*');
const report = (cause: unknown) => {
  failed = true;
  instance?.noLoop();
  send({ kind: 'error', message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 4096) });
};
window.addEventListener('error', event => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => report(event.reason));
window.addEventListener('securitypolicyviolation', event => report(`P5CapabilityDenied: ${event.violatedDirective}`));

function trackLoop(p: P5): void {
  const loop = p.loop.bind(p);
  const noLoop = p.noLoop.bind(p);
  wantsLoop = p.isLooping();
  suspend = noLoop;
  resume = () => { if (wantsLoop && !failed) loop(); };
  p.loop = () => { wantsLoop = true; if (!paused && !failed) loop(); };
  p.noLoop = () => { wantsLoop = false; noLoop(); };
}

window.addEventListener('message', event => {
  if (event.source !== parent || parent === window) return;
  void Effect.runPromise(Effect.try({ try: () => {
    const input = Schema.decodeUnknownSync(P5ControlSchema, { onExcessProperty: 'error' })(event.data);
    if (input.kind === 'start') {
      if (started) return;
      started = true;
      const style = document.createElement('style');
      style.textContent = input.bundle.css;
      document.head.append(style);
      for (const library of input.bundle.libraries) {
        const extension = document.createElement('script');
        extension.textContent = library.source;
        document.body.append(extension);
        if (failed) return;
      }
      const script = document.createElement('script');
      script.textContent = input.bundle.javascript;
      document.body.append(script);
      if (failed) return;
      if (input.bundle.mode === 'instance') {
        if (typeof globals.ConcordSketch?.default !== 'function') throw new Error('P5EntryInvalid: export default function(p) is required');
        const sketch = globals.ConcordSketch.default;
        instance = new P5(p => { trackLoop(p); sketch(p); }, document.body);
      } else {
        instance = new P5();
        trackLoop(instance);
        Object.assign(window, { loop: instance.loop.bind(instance), noLoop: instance.noLoop.bind(instance) });
      }
      if (failed) instance.noLoop();
      else send({ kind: 'started' });
    } else if (input.kind === 'pause' && instance && !paused) {
      paused = true;
      suspend?.();
    } else if (input.kind === 'resume' && instance && paused) {
      paused = false;
      resume?.();
    }
  }, catch: cause => cause })).catch(report);
});

let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.min(2000, Math.max(100, Math.ceil(document.body.getBoundingClientRect().height + 16)));
  if (height !== lastHeight) { lastHeight = height; send({ kind: 'resize', height }); }
}).observe(document.body);
window.addEventListener('pagehide', () => { instance?.remove(); });
send({ kind: 'ready' });
