import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Recording, RecordingSummary, RecordingIndex } from './recordings';

const actual = JSON.parse(readFileSync('docs/benchmarks/recordings/kill_payment-01.json', 'utf8'));
describe('recording contract', () => {
  it('accepts the captured runtime schema and retains actual trace timings', () => {
    const parsed = Recording.parse(actual);
    expect(parsed.frames.length).toBe(actual.frames.length);
    expect(parsed.traces[0].spans).toEqual(actual.traces[0].spans);
    expect(
      RecordingIndex.parse(
        JSON.parse(readFileSync('docs/benchmarks/recordings/index.json', 'utf8')),
      ).runs.length,
    ).toBeGreaterThanOrEqual(4);
  });
  it('rejects unproven sources, missing traces and invalid snapshots', () => {
    expect(Recording.safeParse({ ...actual, source: 'simulated' }).success).toBe(false);
    expect(Recording.safeParse({ ...actual, traces: [] }).success).toBe(false);
    expect(Recording.safeParse({ ...actual, frames: [{ ts: 1 }] }).success).toBe(false);
  });
  it('restricts public replay files to the recording directory', () => {
    const summary = { ...actual, file: 'recordings/kill_payment-01.json' };
    expect(RecordingSummary.safeParse(summary).success).toBe(true);
    expect(
      RecordingSummary.safeParse({ ...summary, file: 'recordings/../../secret.json' }).success,
    ).toBe(false);
    expect(RecordingSummary.safeParse({ ...summary, capturedAt: 'unknown' }).success).toBe(false);
  });
});
