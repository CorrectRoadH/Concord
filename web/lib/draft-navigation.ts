import type { Blocker } from 'react-router-dom';

type Blocked = Extract<Blocker, { state: 'blocked' }>;
export type ReadBlockers = () => Iterable<Blocker>;

export function requiresDraftFlush(dirty: boolean, saving: boolean): boolean {
  return dirty || saving;
}

export async function completeDraftNavigation(
  readBlockers: ReadBlockers,
  blocker: Blocked,
  prepare: () => Promise<boolean>,
  onBlocked?: () => void,
): Promise<void> {
  const ready = await prepare();
  // React can render a new blocker after the router has already replaced it.
  if (!Array.from(readBlockers()).includes(blocker)) return;
  if (ready) blocker.proceed();
  else onBlocked?.();
}
