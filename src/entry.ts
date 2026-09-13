#!/usr/bin/env node
// @concord-file public-entry-routing
// @concord-implements docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
// Keep ordinary help independent of consumer host code.
try {
  if (process.argv.includes('--skill')) {
    const { runSkillMain } = await import('./skill.js');
    await runSkillMain(process.argv.slice(2));
  } else if (process.argv[2] === 'repo') {
    // @concord-begin route-repository-profile
    // @concord-implements docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
    process.argv.splice(2, 1);
    const entry = './repository/cli.js';
    await import(entry);
    // @concord-end route-repository-profile
  } else {
    await import('./cli.js');
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'RepositoryProfileFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
