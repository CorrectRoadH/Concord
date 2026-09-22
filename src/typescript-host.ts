// @concord-file
// @concord-implements docs/feature/local-sdlc/README.md
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as TypeScript from 'typescript';

let packageVersion: string | undefined;

/** Package metadata only. Resolving this path does not evaluate the compiler. */
export function typescriptPackageVersion(): string {
  if (packageVersion !== undefined) return packageVersion;
  const parsed = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('typescript/package.json'), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) throw new Error('typescript package version is unavailable');
  packageVersion = parsed.version;
  return packageVersion;
}

export function loadTypeScript(): typeof TypeScript {
  return createRequire(import.meta.url)('typescript') as typeof TypeScript;
}

/** Property access loads the compiler. Cache hits must not touch the returned namespace. */
export function lazyTypeScript(): typeof TypeScript {
  let loaded: typeof TypeScript | undefined;
  return new Proxy({} as typeof TypeScript, {
    get(_target, property, receiver) {
      loaded ??= loadTypeScript();
      const value: unknown = Reflect.get(loaded, property, receiver);
      return typeof value === 'function' ? value.bind(loaded) : value;
    },
  });
}
