import { Schema } from "effect";

const fields = { operation: Schema.String, path: Schema.optional(Schema.String), message: Schema.String };

export class FeedbackFileMissing extends Schema.TaggedError<FeedbackFileMissing>(
  "concord/FeedbackFileMissing",
)("FeedbackFileMissing", fields) {}

export class FeedbackContentInvalid extends Schema.TaggedError<FeedbackContentInvalid>(
  "concord/FeedbackContentInvalid",
)("FeedbackContentInvalid", fields) {}

export class FeedbackReferenceConflict extends Schema.TaggedError<FeedbackReferenceConflict>(
  "concord/FeedbackReferenceConflict",
)("FeedbackReferenceConflict", fields) {}

export class FeedbackLockConflict extends Schema.TaggedError<FeedbackLockConflict>(
  "concord/FeedbackLockConflict",
)("FeedbackLockConflict", fields) {}

export class FeedbackIoError extends Schema.TaggedError<FeedbackIoError>(
  "concord/FeedbackIoError",
)("FeedbackIoError", fields) {}

export type FeedbackError = FeedbackFileMissing | FeedbackContentInvalid | FeedbackReferenceConflict |
  FeedbackLockConflict | FeedbackIoError;
