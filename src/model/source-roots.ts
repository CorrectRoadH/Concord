
export function withinRoots(path: string, roots: readonly string[]): boolean { return roots.some(root => path === root || path.startsWith(`${root}/`)); }
