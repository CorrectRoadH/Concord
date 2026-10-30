import { refreshQuery } from "../../app/index.js";

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";


import { Query } from "../../app/index.js";





if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  NodeRuntime.runMain(Effect.gen(function*() {
    const query = yield* Schema.decodeUnknownEffect(Query)(JSON.parse(process.argv[3] ?? 'null'));
    const positive = Schema.Number.check(Schema.isGreaterThan(0));
    const requestedAt = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[4]));
    const limitMs = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[5] ?? 120_000));
    yield* refreshQuery(process.argv[2], query, requestedAt, limitMs);
  }).pipe(Effect.scoped));
}
