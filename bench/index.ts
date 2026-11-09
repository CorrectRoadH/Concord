import { registerBenchmarks as documentationQuality } from './documentation-quality.bench.ts';
import { registerBenchmarks as feedback } from './feedback.bench.ts';
import { registerBenchmarks as herdrMod } from './herdr-mod.bench.ts';
import { registerBenchmarks as localDataEngine } from './local-data-engine.bench.ts';
import { registerBenchmarks as localSdlc } from './local-sdlc.bench.ts';
import { registerBenchmarks as projectOnboarding } from './project-onboarding.bench.ts';
import { registerBenchmarks as taste } from './taste.bench.ts';
import { registerBenchmarks as webWorkbench } from './web-workbench.bench.ts';
import { runBenchmarks } from './run.ts';

if (import.meta.main) runBenchmarks(scope => {
  localSdlc(scope);
  documentationQuality(scope);
  feedback(scope);
  herdrMod(scope);
  localDataEngine(scope);
  projectOnboarding(scope);
  taste(scope);
  webWorkbench(scope);
});
