import { Effect } from 'effect';
import { superviseCompiler } from '../../src/base/process/typescript-supervisor.ts';

const [executable, timeout] = process.argv.slice(2);
if (executable === undefined || timeout === undefined) throw new Error('Missing test boundary');
process.exitCode = await Effect.runPromise(superviseCompiler(executable, [
  '--api', '--async', '--cwd', process.cwd(), '--useCaseSensitiveFileNames=true',
  '--callbacks=realpath:identity,stat:fakeStat,writeFile:error,removeFile:error,readFile,fileExists,directoryExists,getAccessibleEntries',
], Number(timeout)));
