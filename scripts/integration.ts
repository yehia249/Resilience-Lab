import { execFileSync, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  Snapshot,
  FaultType,
  Fault,
  CheckoutResponse,
  Product,
} from '../packages/common/src/schemas';
import { sleep } from '../packages/common/src/resilience';
const base = process.env.BASE_URL ?? 'http://localhost:8088';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw Error('Integration fixtures require localhost; never reset public visitor quotas');
const measurements: object[] = [];
function docker(args: string[]) {
  return execFileSync(
    process.platform === 'win32' ? 'wsl' : 'docker',
    process.platform === 'win32'
      ? ['-d', 'ResilienceLab', '--cd', process.cwd(), '--exec', 'docker', ...args]
      : args,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
function resetQuota() {
  docker([
    'compose',
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'EVAL',
    "local keys=redis.call('KEYS','quota:*');for _,key in ipairs(keys) do redis.call('DEL',key) end;return #keys",
    '0',
  ]);
}
async function snapshot() {
  return Snapshot.parse(await (await fetch(base + '/v1/snapshot')).json());
}
async function until(fn: () => Promise<boolean>, ms = 150000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(1000);
  }
  throw Error('Integration condition timed out');
}
async function inject(type: FaultType) {
  return fetch(base + '/api/chaos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type }),
  });
}
async function ready() {
  await until(async () => {
    const s = await snapshot();
    return (
      !s.fault && s.cooldownUntil < Date.now() && s.metrics.p95 !== null && s.metrics.p95 < 250
    );
  });
}
const invalid = await fetch(base + '/api/chaos', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'SHELL', command: 'anything' }),
});
if (invalid.status !== 400) throw Error('Fault schema must reject free-form input');
await ready();
resetQuota();
const products = Product.array().parse(await (await fetch(base + '/api/products')).json());
async function checkout() {
  const cartId = randomUUID();
  const headers = {
    'content-type': 'application/json',
    'x-cart-id': cartId,
    'idempotency-key': cartId,
  };
  await fetch(base + '/api/cart', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ items: [{ productId: products[0].id, quantity: 1 }] }),
  });
  return CheckoutResponse.parse(
    await (
      await fetch(base + '/api/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cartId }),
      })
    ).json(),
  );
}
function orderState(id: string) {
  return JSON.parse(
    docker([
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'lab',
      '-d',
      'lab',
      '-At',
      '-c',
      `SELECT json_build_object('status',o.status,'amount',o.amount,'key',o.idempotency_key,'payments',(SELECT count(*) FROM payments p WHERE p.order_id=o.id)) FROM orders o WHERE o.id='${id}'`,
    ]).trim(),
  ) as { status: string; amount: number; key: string; payments: number };
}
function redisCommand(...args: string[]) {
  return docker(['compose', 'exec', '-T', 'redis', 'redis-cli', '--raw', ...args]).trim();
}
function sampleTtl(type: FaultType): Promise<number> {
  const args = ['compose', 'exec', '-T', 'redis', 'redis-cli', '--raw', 'PTTL', `fault:${type}`];
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.platform === 'win32' ? 'wsl' : 'docker',
      process.platform === 'win32'
        ? ['-d', 'ResilienceLab', '--cd', process.cwd(), '--exec', 'docker', ...args]
        : args,
      { encoding: 'utf8', timeout: 30000 },
      (error, stdout) => (error ? reject(error) : resolve(Number(stdout.trim()))),
    );
    child.stdin?.end();
  });
}
for (const type of FaultType.options) {
  let queuedOrderId: string | undefined;
  await ready();
  resetQuota();
  const started = Date.now();
  const baseline = await snapshot();
  const response = await inject(type);
  if (!response.ok)
    throw Error(`${type}: injection failed ${response.status}: ${await response.text()}`);
  const configuredTtlMs =
    type === 'KILL_PAYMENT' ? 90000 : type === 'SPIKE_TRAFFIC' ? 60000 : 30000;
  const injected = Fault.parse(((await response.json()) as { active: unknown }).active);
  if (injected.expiresAt - injected.startedAt !== configuredTtlMs)
    throw Error('Fault expiry contract changed');
  // Observe Redis without blocking the real checkout traffic during a short outage.
  const ttlSample = sampleTtl(type).then(
    (value) => ({ value }),
    (error) => ({ error: String(error) }),
  );
  const second = await inject(type);
  if (
    second.status !== 409 ||
    !String(((await second.json()) as { error: string }).error)
      .toLowerCase()
      .includes('another')
  )
    throw Error('Global active-fault slot failed');
  if (type === 'KILL_PAYMENT') {
    await Promise.all(Array.from({ length: 12 }, checkout));
    await until(async () => (await snapshot()).breaker === 'open', 15000);
    const order = await checkout();
    if (order.status !== 'queued') throw Error('Open breaker must queue checkout');
    queuedOrderId = order.orderId;
    measurements.push({ type, queuedOrderId: order.orderId, checkoutMs: order.latencyMs });
  }
  if (type === 'ADD_CATALOG_LATENCY' || type === 'SLOW_DATABASE') {
    const start = performance.now();
    const r = await fetch(base + '/api/products');
    if (!r.ok) throw Error('Latency fault browse failed');
    const elapsed = performance.now() - start;
    if (elapsed < 200) throw Error('Expected real latency injection');
    measurements.push({ type, requestMs: elapsed });
  }
  if (type === 'SPIKE_TRAFFIC') {
    await sleep(18000);
    const during = await snapshot();
    if (
      during.metrics.rps === null ||
      baseline.metrics.rps === null ||
      during.metrics.rps <= baseline.metrics.rps
    )
      throw Error('Traffic did not increase');
    measurements.push({ type, baselineRps: baseline.metrics.rps, spikeRps: during.metrics.rps });
  }
  await until(async () => {
    const s = await snapshot();
    return !s.fault && s.cooldownUntil > Date.now();
  });
  const cooling = await inject(type);
  if (
    cooling.status !== 409 ||
    !String(((await cooling.json()) as { error: string }).error)
      .toLowerCase()
      .includes('cooling')
  )
    throw Error('The real post-fault cooldown must reject another injection');
  const sampled = await ttlSample;
  if ('error' in sampled) throw Error(sampled.error);
  const observedTtlMs = sampled.value;
  if (!(observedTtlMs === -2 || (observedTtlMs > 0 && observedTtlMs <= configuredTtlMs)))
    throw Error('Fault flag must expire or already have reverted; an unlimited TTL is invalid');
  measurements.push({
    type,
    configuredTtlMs,
    observedTtlMs,
    flagAlreadyReverted: observedTtlMs === -2,
  });
  await until(async () => {
    const s = await snapshot();
    return s.recoveries.some(
      (r) => r.fault_type === type && Date.parse(r.created_at) >= started - 1000,
    );
  });
  const after = await snapshot();
  measurements.push({
    type,
    recovery: after.recoveries.find(
      (r) => r.fault_type === type && Date.parse(r.created_at) >= started - 1000,
    ),
  });
  if (queuedOrderId) {
    const id = queuedOrderId;
    await until(async () => {
      const s = orderState(id);
      return ['confirmed', 'failed'].includes(s.status) && s.payments === 1;
    });
    const state = orderState(id);
    const results = JSON.parse(
      docker([
        'compose',
        'exec',
        '-T',
        'gateway',
        'node',
        '--input-type=module',
        '-e',
        "const body=JSON.parse(process.argv[1]);const call=async b=>{const r=await fetch('http://payment:8083/charge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()}};console.log(JSON.stringify([await call(body),await call(body),await call({...body,amount:body.amount+1})]));",
        JSON.stringify({ orderId: id, amount: state.amount, idempotencyKey: state.key }),
      ]).trim(),
    ) as { status: number; body: unknown }[];
    if (
      results[0].status !== 200 ||
      JSON.stringify(results[0]) !== JSON.stringify(results[1]) ||
      results[2].status !== 409
    )
      throw Error('Charge idempotency or changed-payload rejection failed');
    const entry = redisCommand('XADD', 'orders.pending', '*', 'orderId', id, 'trace', '{}');
    await until(async () => redisCommand('XRANGE', 'orders.pending', entry, entry) === '');
    if (orderState(id).payments !== 1) throw Error('Stream replay created another payment');
    measurements.push({
      type,
      queuedOrderId: id,
      settledStatus: state.status,
      paymentRows: 1,
      idempotentCharge: true,
      streamReplay: true,
    });
  }
  console.log(`${type}: verified real effect and recovery`);
}
await ready();
const quotaKey = redisCommand('KEYS', 'quota:*').split('\n').filter(Boolean)[0];
if (!quotaKey) throw Error('Expected the actual visitor quota key');
redisCommand('SET', quotaKey, '3', 'EX', '600');
const limited = await inject('ADD_CATALOG_LATENCY');
if (limited.status !== 429) throw Error('Three faults per ten minutes must be enforced');
resetQuota();
measurements.push({
  visitorQuotaStatus: limited.status,
  seededPriorUses: 3,
  cooldownVerified: true,
});
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  'docs/benchmarks/integration.json',
  JSON.stringify({ measuredAt: new Date().toISOString(), target: base, measurements }, null, 2),
);
console.log(
  'All fault integration contracts passed. Visitor quotas reset only inside the isolated local fixture.',
);
