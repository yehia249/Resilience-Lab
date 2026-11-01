import { Product, Snapshot, Cart, CheckoutResponse } from '../packages/common/src/schemas';
import { randomUUID } from 'node:crypto';
const base = process.env.BASE_URL ?? 'http://localhost:8088';
const cartId = randomUUID();
let checkoutTraceId: string | null = null;
async function request(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-cart-id': cartId, 'idempotency-key': cartId },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error(`${path}: ${r.status} ${await r.text()}`);
  if (path === '/api/checkout') checkoutTraceId = r.headers.get('x-trace-id');
  return r.json();
}
const products = Product.array().parse(await request('/api/products'));
if (products.length !== 24) throw Error('Expected seeded catalog');
Cart.parse(
  await request('/api/cart', 'PUT', { items: [{ productId: products[0].id, quantity: 1 }] }),
);
const order = CheckoutResponse.parse(await request('/api/checkout', 'POST', { cartId }));
if (!['confirmed', 'failed', 'queued'].includes(order.status)) throw Error('Invalid order');
const duplicate = CheckoutResponse.parse(await request('/api/checkout', 'POST', { cartId }));
if (duplicate.orderId !== order.orderId) throw Error('Checkout idempotency failed');
const snapshot = Snapshot.parse(await request('/v1/snapshot'));
const stream = await fetch(base + '/v1/stream', { signal: AbortSignal.timeout(10000) });
if (!stream.ok || !stream.body) throw Error('SSE stream unavailable');
const reader = stream.body.getReader();
let snapshots = 0;
let streamBuffer = '';
const decoder = new TextDecoder();
let previousTs = 0;
while (snapshots < 2) {
  const chunk = await reader.read();
  if (chunk.done) throw Error('SSE closed early');
  streamBuffer += decoder.decode(chunk.value, { stream: true });
  let boundary: number;
  while ((boundary = streamBuffer.indexOf('\n\n')) !== -1) {
    const event = streamBuffer.slice(0, boundary);
    streamBuffer = streamBuffer.slice(boundary + 2);
    if (event.startsWith('event: snapshot\n')) {
      const s = Snapshot.parse(JSON.parse(event.slice(event.indexOf('data: ') + 6)));
      if (s.ts > previousTs) {
        snapshots++;
        previousTs = s.ts;
      }
    }
  }
}
await reader.cancel();
let traceSpans: number | null = null;
if (process.env.JAEGER_URL) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await fetch(process.env.JAEGER_URL + '/api/traces/' + checkoutTraceId, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await r.json()) as { data?: { spans?: unknown[] }[] };
    const count = data.data?.[0]?.spans?.length ?? 0;
    if (count > 0) {
      traceSpans = count;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!traceSpans) throw Error('No actual checkout spans reached Jaeger');
}
console.log(
  JSON.stringify(
    {
      target: base,
      products: products.length,
      orderStatus: order.status,
      checkoutMs: order.latencyMs,
      telemetryTs: snapshot.ts,
      liveSseSnapshots: snapshots,
      traceSpans,
      measuredAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
