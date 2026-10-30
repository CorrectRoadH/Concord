import { Schema } from "effect";

const fields = { operation: Schema.String, path: Schema.optional(Schema.String), message: Schema.String };

export class MemoryFileMissing extends Schema.TaggedError<MemoryFileMissing>(
  "@concord/repository/MemoryFileMissing",
)("MemoryFileMissing", fields) {}

export class MemoryContentInvalid extends Schema.TaggedError<MemoryContentInvalid>(
  "@concord/repository/MemoryContentInvalid",
)("MemoryContentInvalid", fields) {}

export class MemoryReferenceConflict extends Schema.TaggedError<MemoryReferenceConflict>(
  "@concord/repository/MemoryReferenceConflict",
)("MemoryReferenceConflict", fields) {}

export class MemoryLockConflict extends Schema.TaggedError<MemoryLockConflict>(
  "@concord/repository/MemoryLockConflict",
)("MemoryLockConflict", fields) {}

export class MemoryIoError extends Schema.TaggedError<MemoryIoError>(
  "@concord/repository/MemoryIoError",
)("MemoryIoError", fields) {}


export type MemoryError = MemoryFileMissing | MemoryContentInvalid | MemoryReferenceConflict |
  MemoryLockConflict | MemoryIoError;
