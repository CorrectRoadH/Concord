import { createHash } from 'node:crypto';

export const TEST_REFERENCE_VERSION = 'concord.test-reference/v1';

export function deriveTestReference(nativePath: string, declarationPath: string, title: string): `neref_${string}` {
  const input = JSON.stringify([TEST_REFERENCE_VERSION, nativePath, declarationPath, title]);
  return `neref_${createHash('sha256').update(input).digest('hex').slice(0, 32)}`;
}
