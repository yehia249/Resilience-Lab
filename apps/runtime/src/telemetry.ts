import { readFile } from 'node:fs/promises';
import { server, redis, sql, emit } from './platform';
import { kube } from './chaos';
import {
  Snapshot,
  Fault,
  BenchmarkResults,
  type LabMetrics,
  type ActiveFault,
} from '../../../packages/common/src/schemas';
import { RecoveryDetector } from '../../../packages/common/src/resilience';
const names = ['gateway', 'catalog', 'cart', 'payment', 'postgres', 'redis'];
type Vector = { metric: Record<string, string>; value: [number, string] };
async function query(q: string) {
  try {
    const r = await fetch(
      `${process.env.PROMETHEUS_URL ?? 'http://prometheus:9090'}/api/v1/query?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(900) },
    );
    const data = (await r.json()) as { status: string; data: { result: Vector[] } };
    if (data.status !== 'success') return [];
    return data.data.result;
  } catch {
    return [];
  }
}
function value(v: Vector[]) {
  const n = Number(v[0]?.value[1]);
  return Number.isFinite(n) ? n : null;
}
async function topology() {
  if (process.env.CHAOS_ADAPTER === 'kubernetes') {
    try {
      const labData = (await kube('/apis/apps/v1/namespaces/lab/deployments')) as {
        items: {
          metadata: { name: string };
          spec: { replicas: number };
          status: { readyReplicas?: number };
        }[];
      };
      const paymentData = await kube('/apis/apps/v1/namespaces/lab-payment/deployments') as typeof labData;
      const data = {items:[...labData.items,...paymentData.items]};
      type PodUsage = {items:{metadata:{name:string};containers:{usage:{cpu:string;memory:string}}[]}[]};
      const paymentMetrics = await kube('/apis/metrics.k8s.io/v1beta1/namespaces/lab-payment/pods').catch(()=>null) as PodUsage|null;
      const labMetrics = (await kube('/apis/metrics.k8s.io/v1beta1/namespaces/lab/pods').catch(
        () => null,
      )) as {
        items: {
          metadata: { name: string };
          containers: { usage: { cpu: string; memory: string } }[];
        }[];
      } | null;
      const metrics = labMetrics ? {items:[...labMetrics.items,...(paymentMetrics?.items??[])]} : null;
      const units = (s: string) =>
        s.endsWith('n')
          ? Number(s.slice(0, -1)) / 1e9
          : s.endsWith('m')
            ? Number(s.slice(0, -1)) / 1000
            : s.endsWith('Ki')
              ? Number(s.slice(0, -2)) * 1024
              : s.endsWith('Mi')
                ? Number(s.slice(0, -2)) * 1024 ** 2
                : Number(s);
      return names.map((name) => {
        const d = data.items.find((d) => d.metadata.name === name);
        const pods = metrics?.items.filter((p) => p.metadata.name.startsWith(name + '-'));
        return {
          name,
          ready: d?.status.readyReplicas ?? 0,
          desired: d?.spec.replicas ?? null,
          cpuPct: pods?.length
            ? (pods.flatMap((p) => p.containers).reduce((s, c) => s + units(c.usage.cpu), 0) / 2) *
              100
            : null,
          memoryBytes: pods?.length
            ? pods.flatMap((p) => p.containers).reduce((s, c) => s + units(c.usage.memory), 0)
            : null,
        };
      });
    } catch {
      return names.map((name) => ({
        name,
        ready: null,
        desired: null,
        cpuPct: null,
        memoryBytes: null,
      }));
    }
  }
  try {
    const res = await fetch(
      (process.env.LOCAL_ADAPTER_URL ?? 'http://local-adapter:8099') + '/topology',
      {
        headers: { 'x-internal-token': process.env.INTERNAL_TOKEN ?? '' },
        signal: AbortSignal.timeout(900),
      },
    );
    if (!res.ok) throw Error();
    return (await res.json()) as {
      name: string;
      ready: number | null;
      desired: number | null;
      cpuPct: number | null;
      memoryBytes: number | null;
    }[];
  } catch {
    return names.map((name) => ({
      name,
      ready: null,
      desired: null,
      cpuPct: null,
      memoryBytes: null,
    }));
  }
}
export async function telemetry() {
  const { app, listen } = await server(8095);
  let latest: Snapshot | null = null;
  const clients = new Set<import('node:http').ServerResponse>();
  let busy = false;
  let recovery: ActiveFault | null = null;
  let peakP95 = 0,
    peakError = 0;
  const detector = new RecoveryDetector();
  function broadcast(type: string, data: unknown) {
    const text = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 65536) {
        client.destroy();
        clients.delete(client);
      } else client.write(text);
    }
  }
  async function sample() {
    if (busy) return;
    busy = true;
    try {
      const base = 'http_server_duration_seconds';
      const labels = 'service="gateway"';
      const total = `sum(rate(${base}_count{${labels}}[15s]))`;
      const qs = [
        total,
        `100 * (sum(rate(${base}_count{${labels},status=~"5.."}[15s])) or vector(0)) / ${total}`,
        ...[0.5, 0.95, 0.99].map(
          (p) =>
            `1000 * histogram_quantile(${p}, sum by (le) (rate(${base}_bucket{${labels}}[15s])))`,
        ),
        `1000 * histogram_quantile(0.95,sum by (le,service) (rate(${base}_bucket[15s])))`,
        `max(breaker_state{service="gateway"} == 1) or max(breaker_state{service="gateway"} == 2) or max(breaker_state{service="gateway"} == 0)`,
      ];
      const [vectors, topo, rawFault, cooldown, events, rawTrace, pending, rows] =
        await Promise.all([
          Promise.all(qs.map(query)),
          topology(),
          redis.get('fault.active'),
          redis.get('fault.cooldown'),
          redis.lrange('events', 0, 49),
          redis.get('latest.trace'),
          redis.get('recovery.pending'),
          sql(
            'SELECT fault_type,duration,peak_p95,peak_error_rate,created_at::text FROM recoveries ORDER BY created_at DESC LIMIT 20',
          ),
        ]);
      const metrics: LabMetrics = {
        rps: value(vectors[0]),
        errorRatePct: value(vectors[1]),
        p50: value(vectors[2]),
        p95: value(vectors[3]),
        p99: value(vectors[4]),
      };
      const state = value(vectors[6]);
      const breaker = state === 1 ? 'open' : state === 2 ? 'half-open' : 'closed';
      const services = topo.map((t) => {
        const n = Number(vectors[5].find((v) => v.metric.service === t.name)?.value[1]);
        const p95 = Number.isFinite(n) ? n : null;
        return {
          ...t,
          p95,
          state:
            t.ready === null
              ? ('unknown' as const)
              : t.ready === 0
                ? ('down' as const)
                : t.ready !== t.desired || (p95 ?? 0) > 250
                  ? ('degraded' as const)
                  : ('healthy' as const),
        };
      });
      latest = Snapshot.parse({
        ts: Date.now(),
        metrics,
        services,
        breaker,
        fault: rawFault ? JSON.parse(rawFault) : null,
        cooldownUntil: Number(cooldown ?? 0),
        chaosEnabled: process.env.CHAOS_ENABLED !== 'false',
        events: events.map((v) => JSON.parse(v)),
        trace: JSON.parse(rawTrace ?? '[]'),
        recoveries: rows.rows,
        source: 'live',
      });
      if (pending) {
        const f = Fault.parse(JSON.parse(pending));
        if (recovery?.id !== f.id) {
          recovery = f;
          peakP95 = 0;
          peakError = 0;
          detector.reset();
        }
        peakP95 = Math.max(peakP95, metrics.p95 ?? 0);
        peakError = Math.max(peakError, metrics.errorRatePct ?? 0);
        const ready = services.every((t) => t.ready !== null && t.ready === t.desired) && !rawFault;
        if (detector.observe(metrics.errorRatePct, metrics.p95, ready)) {
          const duration = (Date.now() - f.startedAt) / 1000;
          const inserted = await sql(
            'INSERT INTO recoveries(fault_id,fault_type,duration,peak_p95,peak_error_rate) VALUES($1,$2,$3,$4,$5) ON CONFLICT(fault_id) DO NOTHING RETURNING id',
            [f.id, f.type, duration, peakP95, peakError],
          );
          await redis.del('recovery.pending');
          if (inserted.rows.length)
            await emit(
              'recovered',
              `Recovered in ${duration.toFixed(1)} s — error rate < 2%, p95 < 250 ms and replicas ready for 10 consecutive seconds`,
            );
          recovery = null;
        }
      }
      broadcast('snapshot', latest);
      broadcast('metrics', metrics);
      broadcast('topology', { services, breaker });
      broadcast('trace', latest.trace);
      broadcast('fault', {
        active: latest.fault,
        cooldownUntil: latest.cooldownUntil,
        chaosEnabled: latest.chaosEnabled,
      });
    } catch (error) {
      app.log.error(error, 'Telemetry sample failed');
    } finally {
      busy = false;
    }
  }
  const sub = redis.duplicate();
  await sub.subscribe('lab.events');
  sub.on('message', (_channel, text) => {
    broadcast('event', JSON.parse(text));
  });
  app.get(
    '/v1/snapshot',
    async (_req, reply) => latest ?? reply.code(503).send({ error: 'Waiting for real telemetry' }),
  );
  app.get('/v1/benchmarks', async () => {
    try {
      return BenchmarkResults.parse(
        JSON.parse(await readFile('docs/benchmarks/results.json', 'utf8')),
      );
    } catch {
      return BenchmarkResults.parse({
        status: 'not_run',
        runs: [],
        measuredAt: null,
        target: null,
      });
    }
  });
  app.get('/v1/stream', async (req, reply) => {
    if (clients.size >= 100) return reply.code(503).send({ error: 'Stream capacity reached' });
    reply.hijack();
    const headers: Record<string, string> = {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    };
    if (req.headers.origin === (process.env.SITE_ORIGIN ?? 'http://localhost:5173'))
      headers['access-control-allow-origin'] = req.headers.origin;
    reply.raw.writeHead(200, headers);
    reply.raw.write('retry: 2000\n\n');
    clients.add(reply.raw);
    if (latest) reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`);
    req.raw.on('close', () => clients.delete(reply.raw));
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': heartbeat\n\n');
  }, 15000);
  const timer = setInterval(() => void sample(), 1000);
  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const c of clients) c.end();
    await sub.quit();
  });
  await sample();
  await listen();
}
