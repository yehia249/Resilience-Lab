import { readFile, writeFile } from 'node:fs/promises';
import { Recording, RecordingIndex } from '../packages/common/src/recordings';
import { FaultType } from '../packages/common/src/schemas';

const index = RecordingIndex.parse(
  JSON.parse(await readFile('docs/benchmarks/recordings/index.json', 'utf8')),
);
function quantile(values: number[], q: number) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return null;
  if (q === 0.5)
    return a.length % 2 ? a[Math.floor(a.length / 2)] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  return a[Math.ceil(q * a.length) - 1];
}
const runs: {
  id: string;
  type: FaultType;
  recoverySeconds: number;
  peakP95Ms: number;
  peakP99Ms: number | null;
  peakErrorRatePct: number;
  baselineRps: number;
  maxRps: number;
  hpa: {
    service: string;
    baselineDesired: number | null;
    desiredIncreaseMs: number | null;
    readyIncreaseMs: number | null;
  }[];
  observedPaymentUnreadyToReadyMs: number | null;
  snapshotCount: number;
  traces: number;
  traceSpans: number;
  collectionErrors: number;
}[] = [];
for (const summary of index.runs) {
  const r = Recording.parse(JSON.parse(await readFile('docs/benchmarks/' + summary.file, 'utf8')));
  const before = r.frames.filter((f) => f.ts <= r.faultStartedAt).at(-1) ?? r.frames[0];
  const after = r.frames.filter((f) => f.ts >= r.faultStartedAt);
  const hpa = ['gateway', 'catalog', 'cart'].map((name) => {
    const initial = before.services.find((s) => s.name === name);
    const desired = after.find((f) => {
      const s = f.services.find((s) => s.name === name);
      return (
        s?.desired !== null &&
        s?.desired !== undefined &&
        initial?.desired !== null &&
        initial?.desired !== undefined &&
        s.desired > initial.desired
      );
    });
    const ready = after.find((f) => {
      const s = f.services.find((s) => s.name === name);
      return (
        s?.ready !== null &&
        s?.ready !== undefined &&
        initial?.ready !== null &&
        initial?.ready !== undefined &&
        s.ready > initial.ready
      );
    });
    return {
      service: name,
      baselineDesired: initial?.desired ?? null,
      desiredIncreaseMs: desired ? desired.ts - r.faultStartedAt : null,
      readyIncreaseMs: ready ? ready.ts - r.faultStartedAt : null,
    };
  });
  const down =
    r.type === 'KILL_PAYMENT'
      ? after.find((f) => {
          const s = f.services.find((s) => s.name === 'payment');
          return (
            s?.ready !== null && s?.ready !== undefined && s.desired !== null && s.ready < s.desired
          );
        })
      : undefined;
  const restored = down
    ? after.find((f) => {
        const s = f.services.find((s) => s.name === 'payment');
        return (
          f.ts > down.ts && s?.ready !== null && s?.ready !== undefined && s.ready === s.desired
        );
      })
    : undefined;
  const p99 = r.frames.map((f) => f.metrics.p99).filter((n): n is number => n !== null);
  runs.push({
    id: r.id,
    type: r.type,
    recoverySeconds: r.recoverySeconds,
    peakP95Ms: r.peakP95,
    peakP99Ms: p99.length ? Math.max(...p99) : null,
    peakErrorRatePct: r.peakErrorRate,
    baselineRps: r.baselineRps,
    maxRps: r.maxRps,
    hpa,
    observedPaymentUnreadyToReadyMs: down && restored ? restored.ts - down.ts : null,
    snapshotCount: r.frames.length,
    traces: r.traces.length,
    traceSpans: r.traces.reduce((n, t) => n + t.spans.length, 0),
    collectionErrors: r.collectionErrors.length,
  });
}
const groups = FaultType.options.map((type) => {
  const values = runs.filter((r) => r.type === type);
  return {
    type,
    count: values.length,
    medianRecoverySeconds: quantile(
      values.map((r) => r.recoverySeconds),
      0.5,
    ),
    p95RecoverySeconds: quantile(
      values.map((r) => r.recoverySeconds),
      0.95,
    ),
    medianPeakP95Ms: quantile(
      values.map((r) => r.peakP95Ms),
      0.5,
    ),
    maxObservedP99Ms: quantile(
      values.map((r) => r.peakP99Ms).filter((v): v is number => v !== null),
      1,
    ),
  };
});
const complete = groups.every((g) => g.count >= 10);
await writeFile(
  'docs/benchmarks/analysis.json',
  JSON.stringify(
    {
      analyzedAt: new Date().toISOString(),
      capturedThrough: index.generatedAt,
      complete,
      groups,
      runs,
    },
    null,
    2,
  ) + '\n',
);
const fmt = (v: number | null) => (v === null ? 'not observed' : v.toFixed(3));
const rows = groups.map(
  (g) =>
    `| ${g.type} | ${g.count} | ${fmt(g.medianRecoverySeconds)} | ${fmt(g.p95RecoverySeconds)} | ${fmt(g.medianPeakP95Ms)} | ${fmt(g.maxObservedP99Ms)} |`,
);
const scaling = runs
  .filter((r) => r.type === 'SPIKE_TRAFFIC')
  .flatMap((r) =>
    r.hpa
      .filter((h) => h.desiredIncreaseMs !== null)
      .map(
        (h) =>
          `| ${r.id} | ${h.service} | ${h.baselineDesired} | ${fmt(h.desiredIncreaseMs! / 1000)} | ${fmt(h.readyIncreaseMs === null ? null : h.readyIncreaseMs / 1000)} |`,
      ),
  );
await writeFile(
  'docs/benchmarks/REPORT.md',
  `# Measured local fault experiments

Captured through ${index.generatedAt}. **${runs.length}/${index.expectedRuns} required runs; ${complete ? 'ten or more per fault, complete' : 'campaign incomplete'}.** Target: local k3d on the existing Windows/WSL workstation. No production throughput or availability claim is made.

| Fault | Runs | Median recovery s | Sample p95 recovery s | Median peak p95 ms | Max observed p99 ms |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

Recovery requires fault clearance, ready replicas, p95 below 250 ms and HTTP error rate below 2% for ten consecutive samples. The sample p95 is nearest rank; at ten samples it equals the largest observed duration. Request p95/p99 are Prometheus histogram estimates, distinct from the distribution of recovery durations.

## Autoscaling observations during recorded spikes

| Run | Service | Initial desired | First desired increase s | First ready increase s |
|---|---|---:|---:|---:|
${scaling.length ? scaling.join('\n') : '| No increase observed in these capture windows | — | — | — | — |'}

Times above start at accepted fault injection, using the first actual one-second snapshot showing an increase. This is sampled observation latency, not an exact HPA-controller timestamp. Runs without an observed increase retain null in analysis.json; an already scaled service may remain at its ceiling. Only these observed increases are counted as scale-up evidence.

## Method and raw evidence

Wait for healthy metrics, no active fault, expired cooldown and ready replicas. Capture the baseline, inject one normal-duration fault, submit real shop traffic and wait for the persisted recovery record. Payment-kill experiments include a real checkout burst to exercise independently scoped gateway breakers. The privileged local fixture resets visitor quota between experiments; the global slot, TTL and cooldown are unchanged.

Raw JSON is duplicated in [recordings/](recordings/) and apps/web/public/recordings/. It includes actual metrics, topology, events, checkout timings and normalized OpenTelemetry spans. [analysis.json](analysis.json) derives per-run p99, HPA observations and observed payment unready-to-ready intervals. Missing observations stay null. The latter intervals are not exact pod scheduling durations.

Total captured: ${runs.reduce((n, r) => n + r.snapshotCount, 0)} snapshots, ${runs.reduce((n, r) => n + r.traces, 0)} traces and ${runs.reduce((n, r) => n + r.traceSpans, 0)} spans. Collection errors: ${runs.reduce((n, r) => n + r.collectionErrors, 0)}; timestamps and errors are preserved rather than filled.

## Limits and interruptions

One shared HDD-backed Windows/WSL machine, four virtual CPUs and 5 GB VM memory. Dashboard CPU percentages use a two-core reference budget. Synthetic shoppers create real HTTP/SQL/queue work; payment processor behavior is deliberately simulated. Database slowdown is an explicit query-wrapper delay. These are local observations subject to host contention, histogram bucket precision and one-second sampling.

Completed-recovery statistics exclude interrupted attempts and are not an experiment success rate. See [capture provenance](PROVENANCE.md) and [the interrupted build-contention attempt](interrupted-build-contention.json). Initial runtime identifier limitations are documented there. The running-image identifier and recorder revision describe different artifacts; recordings do not claim to measure a later image build.

Baseline, spike and one-hour soak measurements from the separate Compose CI environment are kept separately under load/ when available. Lighthouse reports measure the public static frontend. Neither dataset is presented as local k3d throughput.
`,
);
console.log(`Analyzed ${runs.length} actual recordings; complete=${complete}`);
