import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { recordRed, recordTakeover, repositoryRoot } from './native-runner.js';

class EvidenceInputError extends Schema.TaggedError<EvidenceInputError>()('EvidenceInputError', {
  message: Schema.String
}) {}

const program = Effect.try({
  try: () => {
    const operation = process.argv[2];
    const epoch = Number(process.argv[3]);
    const defectRef = process.argv[4];
    if ((operation !== 'red' && operation !== 'takeover') || !Number.isInteger(epoch) || epoch < 0 || (operation === 'red' && defectRef === undefined)) {
      throw new EvidenceInputError({ message: 'usage: record-evidence.ts red <epoch> <defect-ref> | takeover <epoch>' });
    }
    if (operation === 'red') recordRed(repositoryRoot, epoch, defectRef!);
    else recordTakeover(repositoryRoot, epoch);
  },
  catch: cause => cause instanceof Error ? cause : new Error(String(cause))
});

NodeRuntime.runMain(program);
