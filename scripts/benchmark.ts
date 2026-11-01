import { writeFile, mkdir } from 'node:fs/promises';
import { FaultType, Snapshot } from '../packages/common/src/schemas';
import { sleep } from '../packages/common/src/resilience';
const base = process.env.BASE_URL ?? 'http://localhost:8088';
const repeats = Number(process.env.BENCH_REPEATS ?? 10);
if (repeats < 10) throw Error('Published benchmarks require at least ten repetitions per fault');
const runs: { type: FaultType; duration: number; peakP95: number; peakErrorRate: number }[] = [];
for (const type of FaultType.options)
  for (let i = 0; i < repeats; i++) {
    console.log(`${type}: ${i + 1}/${repeats}`);
    // Benchmark runner must target a local/private deployment. The public per-IP safety limit stays intact.
    // Wait quota window between groups; never bypass the public rate limiter.
    for (;;) {
      const r = await fetch(base + '/api/chaos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (r.ok) break;
      if (r.status === 429) {
        console.log('Visitor quota: waiting ten minutes');
        await sleep(600000);
        continue;
      }
      if (r.status === 409) {
        await sleep(16000);
        continue;
      }
      throw Error(`Fault injection ${r.status}: ${await r.text()}`);
    }
    let result: Snapshot['recoveries'][number] | undefined;
    const started = Date.now();
    const timeline: Snapshot[] = [];
    while (Date.now() - started < 240000) {
      const s = Snapshot.parse(await (await fetch(base + '/v1/snapshot')).json());
      timeline.push(s);
      result = s.recoveries.find(
        (r) => r.fault_type === type && Date.parse(r.created_at) >= started - 2000,
      );
      if (result) break;
      await sleep(1000);
    }
    if (!result) throw Error(`${type}: no measured recovery within four minutes`);
    runs.push({
      type,
      duration: result.duration,
      peakP95: result.peak_p95,
      peakErrorRate: result.peak_error_rate,
    });
    await mkdir('docs/benchmarks/raw', { recursive: true });
    await writeFile(`docs/benchmarks/raw/${type}-${i + 1}.json`, JSON.stringify(timeline, null, 2));
    await sleep(20000);
    await writeFile(
      'docs/benchmarks/results.json',
      JSON.stringify(
        { status: 'measured', runs, measuredAt: new Date().toISOString(), target: base },
        null,
        2,
      ),
    );
  }
const stats = FaultType.options.map((type) => {
  const values = runs
    .filter((r) => r.type === type)
    .map((r) => r.duration)
    .sort((a, b) => a - b);
  return `| ${type} | ${values.length} | ${((values[4] + values[5]) / 2).toFixed(2)} | ${values[Math.ceil(values.length * 0.95) - 1].toFixed(2)} |`;
});
await writeFile(
  'docs/benchmarks/REPORT.md',
  `# Measured fault recoveries\n\nTarget: ${base}\n\nMeasured: ${new Date().toISOString()}\n\n| Fault | Runs | Median s | p95 s |\n|---|---:|---:|---:|\n${stats.join('\n')}\n\nRecovery requires ten consecutive healthy one-second samples after fault clearance. Raw snapshots: raw/. Prometheus histograms estimate latency; the single node, synthetic load and sample size limit generalization. CPU autoscaling must be assessed separately on Kubernetes.\n`,
);
