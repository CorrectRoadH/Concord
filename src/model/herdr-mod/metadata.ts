// @concord-file
// @concord-implements docs/feature/herdr-mod/use-case/install-from-herdr.md
import { Schema } from 'effect';

export const ModVersion = Schema.String.check(Schema.isPattern(/^(?:dev|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u));
export const ModManifest = Schema.Struct({ minimumConcordVersion: ModVersion });

/** The package version is the single source for the mod's minimum CLI version. */
export function modManifest(version: string) {
  return { place: 'right', size: 760, minimumConcordVersion: Schema.decodeUnknownSync(ModVersion)(version), overlay: { width: 760, height: 220 } } as const;
}

/** SemVer precedence; source checkouts use dev without claiming release ordering. */
export function compareModVersions(current: string, minimum: string): number {
  const left = Schema.decodeUnknownSync(ModVersion)(current), right = Schema.decodeUnknownSync(ModVersion)(minimum);
  if (left === 'dev' || right === 'dev') return 0;
  const parts = (version: string) => version.split('+')[0]!.split(/-(.*)/su);
  const [a, aPre] = parts(left), [b, bPre] = parts(right);
  const aNumbers = a!.split('.').map(Number), bNumbers = b!.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (aNumbers[index] !== bNumbers[index]) return aNumbers[index]! < bNumbers[index]! ? -1 : 1;
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined || bPre === undefined) return aPre === undefined ? 1 : -1;
  const aa = aPre.split('.'), bb = bPre.split('.');
  for (let index = 0; index < Math.max(aa.length, bb.length); index++) {
    const x = aa[index], y = bb[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/u.test(x), yn = /^\d+$/u.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
