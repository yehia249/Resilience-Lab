import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  FaultType,
  Fault,
  Snapshot,
  Product,
  CheckoutResponse,
} from '../packages/common/src/schemas';
import {
  Recording,
  RecordingIndex,
  type RecordingSummary,
} from '../packages/common/src/recordings';
import { sleep } from '../packages/common/src/resilience';
const base = process.env.RECORD_URL ?? 'http://localhost:8089';
const jaeger = process.env.JAEGER_URL ?? 'http://localhost:16687';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || new URL(base).port !== '8089')
  throw Error('Recording fixtures are restricted to the local k3d target on port 8089');
const repeats = Number(process.env.RECORD_REPEATS ?? 10);
if (repeats < 10) throw Error('At least ten recordings per fault are required');
function local(args: string[], input?: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync(
        process.platform === 'win32' ? 'wsl' : args[0],
        process.platform === 'win32'
          ? ['-d', 'ResilienceLab', '--cd', process.cwd(), '--', ...args]
          : args.slice(1),
        { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 },
      ).trim();
    } catch {
      if (attempt === 2)
        throw Error(`Local tool failed after bounded retries: ${args[0]} ${args[1]}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  throw Error('Local tool failed');
}
if (local(['kubectl', 'config', 'current-context']) !== 'k3d-resilience-lab')
  throw Error('Wrong Kubernetes context');
const runtimePods = JSON.parse(
  local(['kubectl', 'get', 'pods', '-n', 'lab', '-l', 'app=gateway', '-o', 'json']),
) as { items: { status: { containerStatuses?: { imageID: string }[] } }[] };
const imageDigest = runtimePods.items.flatMap((p) => p.status.containerStatuses ?? [])[0]?.imageID;
if (!imageDigest) throw Error('Cannot establish the running image digest');
const nodeVersion = local([
  'kubectl',
  'exec',
  'deployment/telemetry-api',
  '-n',
  'lab',
  '--',
  'node',
  '--version',
]);
const recorderRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const publicRoot = 'apps/web/public';
await mkdir(publicRoot + '/recordings', { recursive: true });
await mkdir('docs/benchmarks/recordings', { recursive: true });
await mkdir('.local', { recursive: true });
let index: ReturnType<typeof RecordingIndex.parse>;
try {
  index = RecordingIndex.parse(
    JSON.parse(await readFile(publicRoot + '/recordings/index.json', 'utf8')),
  );
} catch {
  index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    expectedRuns: repeats * 4,
    runs: [],
  };
}
async function atomic(path: string, data: unknown) {
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}
async function getSnapshot() {
  const r = await fetch(base + '/v1/snapshot', { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw Error(`Snapshot ${r.status}`);
  return Snapshot.parse(await r.json());
}
async function until(fn: () => Promise<boolean>, timeout = 300000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {
      /* a failed poll is not a healthy sample */
    }
    await sleep(1000);
  }
  throw Error('Local recording prerequisite timed out');
}
async function healthy() {
  await until(async () => {
    const s = await getSnapshot();
    return (
      !s.fault &&
      s.cooldownUntil < Date.now() &&
      s.metrics.p95 !== null &&
      s.metrics.p95 < 250 &&
      s.metrics.errorRatePct !== null &&
      s.metrics.errorRatePct < 2 &&
      s.services.every((v) => v.ready !== null && v.ready === v.desired)
    );
  });
}
async function products() {
  return Product.array().parse(await (await fetch(base + '/api/products')).json());
}
async function prepareCart(productId: string) {
  const id = randomUUID();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(base + '/api/cart', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-cart-id': id },
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return id;
    } catch {
      /* fixture preparation may retry the same idempotent cart */
    }
    await sleep(500 * (attempt + 1));
  }
  throw Error('Cart fixture could not be prepared after bounded retries');
}
async function prepareBatch(count: number, productId: string) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 8)
    ids.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(8, count - i) }, () => prepareCart(productId)),
      )),
    );
  return ids;
}
async function checkout(cartId: string, checkouts: Recording['checkouts']) {
  try {
    const r = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': cartId },
      body: JSON.stringify({ cartId }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      const result = CheckoutResponse.parse(await r.json());
      const saved = { ts: Date.now(), traceId: r.headers.get('x-trace-id'), result };
      checkouts.push(saved);
      return saved;
    }
  } catch {
    /* unsuccessful requests remain observable in real service metrics */
  }
  return null;
}
async function readTraces(ids: string[]) {
  const traces: Recording['traces'] = [];
  for (const id of [...new Set(ids)].slice(0, 5)) {
    try {
      const r = await fetch(jaeger + '/api/traces/' + id, { signal: AbortSignal.timeout(5000) });
      const d = (await r.json()) as {
        data?: {
          processes: Record<string, { serviceName: string }>;
          spans: {
            startTime: number;
            duration: number;
            processID: string;
            operationName: string;
            tags: { key: string; value: unknown }[];
          }[];
        }[];
      };
      const t = d.data?.[0];
      if (!t?.spans.length) continue;
      const start = Math.min(...t.spans.map((s) => s.startTime));
      traces.push({
        traceId: id,
        spans: t.spans.map((s) => ({
          service: t.processes[s.processID]?.serviceName ?? 'unknown',
          operation: s.operationName,
          offsetMs: (s.startTime - start) / 1000,
          durationMs: s.duration / 1000,
          error: s.tags?.some((t) => t.key === 'error' && t.value === true) || false,
        })),
      });
    } catch {
      /* only actual successfully retrieved spans are recorded */
    }
  }
  return traces;
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median:
      sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
async function publishMetadata() {
  index.generatedAt = new Date().toISOString();
  index.expectedRuns = Math.max(repeats * 4, index.runs.length);
  await atomic(publicRoot + '/recordings/index.json', index);
  await atomic('docs/benchmarks/recordings/index.json', index);
  const runs = index.runs.map((r) => ({
    type: r.type,
    duration: r.recoverySeconds,
    peakP95: r.peakP95,
    peakErrorRate: r.peakErrorRate,
  }));
  const results = {
    status: runs.length ? 'measured' : 'not_run',
    runs,
    measuredAt: runs.length ? index.generatedAt : null,
    target: base,
    expectedRuns: index.expectedRuns,
    complete: runs.length >= index.expectedRuns,
  };
  await atomic('docs/benchmarks/results.json', results);
  await atomic(publicRoot + '/recordings/benchmarks.json', results);
  const rows = FaultType.options.map((type) => {
    const matching = index.runs.filter((r) => r.type === type);
    if (!matching.length) return `| ${type} | 0 | unmeasured | unmeasured |`;
    const stats = summarize(matching.map((r) => r.recoverySeconds));
    return `| ${type} | ${matching.length} | ${stats.median.toFixed(3)} | ${stats.p95.toFixed(3)} |`;
  });
  await writeFile(
    'docs/benchmarks/REPORT.md',
    `# Real local recordings\n\nCaptured on ${index.generatedAt}. Completed ${index.runs.length}/${index.expectedRuns} required runs. Target: ${base} (k3d).\n\n| Fault | Runs | Median recovery s | Sample p95 recovery s |\n|---|---:|---:|---:|\n${rows.join('\n')}\n\nEvery JSON file contains actual timestamped metrics, topology, request timings, events and retrieved normalized OpenTelemetry spans. Payment processing is deliberately simulated; requests, faults, persistence and timings are real. No missing measurements are filled with generated values.\n\nMethod: wait for a healthy baseline; capture baseline frames; inject exactly one normal-TTL fault; wait for the system recovery event (ten consecutive healthy samples and ready replicas); capture the result. The local administrative fixture resets only the visitor quota between runs; the global fault slot, TTL and cooldown remain enforced. Payment-kill runs include a real checkout burst to exercise each gateway replica's breaker before pods recover.\n\nRaw evidence is in recordings/ and apps/web/public/recordings/. Runtime image digest, runtime Node version and recorder revision are embedded. Recordings describe their captured image, not a later build. Replay is labelled and never presented as a current live system.\n\nCaveats: one shared Windows/WSL machine; CPU-driven HPA; histogram percentile estimates; deliberately synthetic shoppers; no external payment network; local background test activity can affect timings. These are local observations, not production or cloud claims.\n`,
  );
  await atomic('.local/record-progress.json', {
    completed: index.runs.length,
    expected: index.expectedRuns,
    updatedAt: index.generatedAt,
    counts: Object.fromEntries(
      FaultType.options.map((t) => [t, index.runs.filter((r) => r.type === t).length]),
    ),
  });
}
await publishMetadata();
for (let round = 0; round < repeats; round++)
  for (const type of FaultType.options) {
    if (index.runs.filter((r) => r.type === type).length > round) continue;
    console.log(
      `${new Date().toISOString()} ${type} run ${round + 1}/${repeats}: waiting for healthy local system`,
    );
    await healthy();
    local(['bash', 'scripts/reset-local-quotas.sh']);
    const catalog = await products();
    const checkouts: Recording['checkouts'] = [];
    const baseline = await getSnapshot();
    const prepared =
      type === 'KILL_PAYMENT'
        ? await prepareBatch(
            Math.max(30, (baseline.services.find((s) => s.name === 'gateway')?.desired ?? 2) * 12),
            catalog[0].id,
          )
        : [];
    const frames: Snapshot[] = [];
    const collectionErrors: Recording['collectionErrors'] = [];
    let collecting = true;
    const collector = (async () => {
      while (collecting) {
        try {
          const s = await getSnapshot();
          if (s.ts !== frames.at(-1)?.ts) frames.push(s);
        } catch (error) {
          collectionErrors.push({ ts: Date.now(), message: (error as Error).message });
        }
        await sleep(1000);
      }
    })();
    try {
      await checkout(await prepareCart(catalog[0].id), checkouts);
      await sleep(3000);
      const response = await fetch(base + '/api/chaos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        collecting = false;
        await collector;
        throw Error(`${type}: injection ${response.status}: ${await response.text()}`);
      }
      const injected = Fault.parse(((await response.json()) as { active: unknown }).active);
      console.log(`${type}: injected real fault ${injected.id}`);
      if (type === 'KILL_PAYMENT') await Promise.all(prepared.map((id) => checkout(id, checkouts)));
      else {
        await sleep(2000);
        await checkout(await prepareCart(catalog[0].id), checkouts);
      }
      let recovered: Snapshot['recoveries'][number] | undefined;
      await until(async () => {
        const s = await getSnapshot();
        recovered = s.recoveries.find(
          (r) => r.fault_type === type && Date.parse(r.created_at) >= injected.startedAt,
        );
        return !!recovered;
      }, 360000);
      if (!recovered) throw Error('No real recovery record');
      await checkout(await prepareCart(catalog[0].id), checkouts);
      await sleep(2000);
      collecting = false;
      await collector;
      const traces = await readTraces(
        checkouts.map((c) => c.traceId).filter((id): id is string => !!id),
      );
      const id = `${type.toLowerCase()}-${String(round + 1).padStart(2, '0')}`;
      const rps = frames.map((f) => f.metrics.rps).filter((n): n is number => n !== null);
      if (!rps.length) throw Error('No measured traffic');
      const capture = Recording.parse({
        version: 1,
        id,
        type,
        environment: 'k3d',
        capturedAt: new Date(injected.startedAt).toISOString(),
        source: 'real-local-system',
        faultStartedAt: injected.startedAt,
        recoverySeconds: recovered.duration,
        peakP95: recovered.peak_p95,
        peakErrorRate: recovered.peak_error_rate,
        baselineRps: baseline.metrics.rps,
        maxRps: Math.max(...rps),
        runtime: {
          imageDigest,
          recorderRevision,
          nodeVersion,
          notes:
            'Existing local k3d runtime; per-visitor quota reset only in the privileged local test fixture. Normal fault TTL and cooldown retained. Waterfall frames are measured checkout timings; traces contain only allowlisted normalized spans from Jaeger.',
        },
        products: catalog,
        frames,
        checkouts,
        traces,
        collectionErrors,
      });
      await atomic(`${publicRoot}/recordings/${id}.json`, capture);
      await atomic(`docs/benchmarks/recordings/${id}.json`, capture);
      const summary: RecordingSummary = {
        id,
        type,
        environment: 'k3d',
        capturedAt: capture.capturedAt,
        recoverySeconds: capture.recoverySeconds,
        peakP95: capture.peakP95,
        peakErrorRate: capture.peakErrorRate,
        baselineRps: capture.baselineRps,
        maxRps: capture.maxRps,
        file: `recordings/${id}.json`,
      };
      index.runs.push(summary);
      await publishMetadata();
      console.log(
        `SAVED ${id}: recovery ${capture.recoverySeconds.toFixed(3)} s; ${frames.length} real frames; ${traces.length} OTel traces; ${index.runs.length}/${index.expectedRuns}`,
      );
    } catch (error) {
      await mkdir('docs/benchmarks/interrupted', { recursive: true });
      await atomic(`docs/benchmarks/interrupted/${type.toLowerCase()}-${Date.now()}.json`, {
        status: 'interrupted',
        type,
        observedAt: new Date().toISOString(),
        error: (error as Error).message,
        frames,
        checkouts,
        collectionErrors,
        notes:
          'Incomplete attempt, excluded from successful recovery statistics. Actual collected data is preserved without filling gaps.',
      });
      throw error;
    } finally {
      collecting = false;
      await collector;
    }
  }
console.log('All required recordings complete.');
await import('./analyze-recordings');
