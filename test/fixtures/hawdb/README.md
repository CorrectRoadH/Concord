# Official HawDB lifecycle fixtures

`test/process/hawdb-native.test.ts` is self-contained: its child roles run the
same TypeScript file through the pinned Bun executable. They use the official
C ABI to hold an active or lazy database, acquire a real clear guard, or block
inside a synchronous transaction until the parent terminates the process.

Every database is created with the current verified official library in a
private temporary directory. No archived database, fork, compiler or test-hook
binary is needed. The release workflow can run the file directly on each host.

`test/fixtures/hawdb-interrupted.ts` writes a committed row and terminates without
closing its handle, for workspace recovery tests.

`row-page-v1.tar.gz` is an empty cache created with the cached HawDB 0.29.0
Concord adapter. It contains real relational row-page v1 files, no source or
user data. The pinned official 0.31.0 reader rejects its schema query with
`unsupported_storage_format`. The schema invalidation test copies it into a
private repository and exercises automatic guarded clearing through the real
database Worker. Tests do not load the old adapter or download an old engine.
