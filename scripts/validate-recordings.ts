import { readFile } from 'node:fs/promises';
import { Recording, RecordingIndex } from '../packages/common/src/recordings';
import { FaultType } from '../packages/common/src/schemas';
const root = 'apps/web/public/';
const index = RecordingIndex.parse(
  JSON.parse(await readFile(root + 'recordings/index.json', 'utf8')),
);
for (const summary of index.runs) {
  const recording = Recording.parse(JSON.parse(await readFile(root + summary.file, 'utf8')));
  if (
    recording.id !== summary.id ||
    recording.type !== summary.type ||
    recording.recoverySeconds !== summary.recoverySeconds
  )
    throw Error('Recording manifest mismatch');
  if (!recording.traces.length) throw Error(`${recording.id}: no real OTel trace captured`);
  if (
    !recording.frames.some((f) => f.fault?.type === recording.type) &&
    !(
      recording.type === 'KILL_PAYMENT' &&
      recording.traces.some((t) => t.spans.some((s) => s.error))
    )
  )
    throw Error(`${recording.id}: fault was not captured`);
  for (let i = 1; i < recording.frames.length; i++)
    if (recording.frames[i].ts <= recording.frames[i - 1].ts)
      throw Error('Frames must preserve the real increasing capture clock');
  if (recording.frames.at(-1)!.ts < recording.faultStartedAt + recording.recoverySeconds * 1000)
    throw Error('Recording ends before measured recovery');
}
const minimum = process.env.REQUIRE_FULL_RECORDINGS === 'true' ? 10 : 1;
for (const type of FaultType.options)
  if (index.runs.filter((r) => r.type === type).length < minimum)
    throw Error(`${type}: need ${minimum} actual recordings`);
console.log(
  `Validated ${index.runs.length} real recording files; minimum ${minimum} per fault; no placeholder data.`,
);
