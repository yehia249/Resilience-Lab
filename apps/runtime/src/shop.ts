import { randomUUID } from 'node:crypto';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { server, sql, redis, call, emit, breakerGauge, HttpError } from './platform';
import {
  Cart,
  CartId,
  Product,
  CheckoutRequest,
  ChargeRequest,
  ChargeResponse,
  CheckoutResponse,
} from '../../../packages/common/src/schemas';
import {
  CircuitBreaker,
  CircuitOpenError,
  sleep,
  breakerDefaults,
} from '../../../packages/common/src/resilience';
export async function catalog() {
  const { app, listen } = await server(8081);
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/products') && (await redis.exists('fault:ADD_CATALOG_LATENCY')))
      await sleep(300 + Math.random() * 200);
  });
  app.get('/products', async () => {
    const { rows } = await sql('SELECT id,name,price,icon FROM products ORDER BY id');
    return Product.array().parse(rows);
  });
  app.get<{ Params: { id: string } }>('/products/:id', async (req, reply) => {
    const id = CartId.parse(req.params.id);
    const { rows } = await sql('SELECT id,name,price,icon FROM products WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Product not found' });
    return Product.parse(rows[0]);
  });
  await listen();
}
export async function cart() {
  const { app, listen } = await server(8082);
  app.get<{ Params: { id: string } }>('/cart/:id', async (req) =>
    Cart.parse(
      JSON.parse((await redis.get(`cart:${CartId.parse(req.params.id)}`)) ?? '{"items":[]}'),
    ),
  );
  app.put<{ Params: { id: string } }>('/cart/:id', async (req) => {
    const id = CartId.parse(req.params.id);
    const cart = Cart.parse(req.body);
    await redis.set(`cart:${id}`, JSON.stringify(cart), 'EX', 3600);
    return cart;
  });
  await listen();
}
export async function payment() {
  const { app, listen } = await server(8083);
  app.post('/charge', async (req, reply) => {
    const data = ChargeRequest.parse(req.body);
    const client = await sql(
      'SELECT amount,order_id,result FROM payments WHERE idempotency_key=$1',
      [data.idempotencyKey],
    );
    if (client.rows[0]) {
      if (client.rows[0].amount !== data.amount || client.rows[0].order_id !== data.orderId)
        return reply.code(409).send({ error: 'Idempotency key payload mismatch' });
      return ChargeResponse.parse(client.rows[0].result);
    }
    // Deliberately simulated processor. Real HTTP, DB persistence and elapsed time.
    const normal =
      Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-12))) *
      Math.cos(2 * Math.PI * Math.random());
    await sleep(Math.exp(Math.log(45) + 0.52 * normal));
    const result = ChargeResponse.parse({
      status: Math.random() < Number(process.env.DECLINE_RATE ?? 0.01) ? 'declined' : 'approved',
      idempotencyKey: data.idempotencyKey,
    });
    const stored = await sql(
      'INSERT INTO payments(idempotency_key,order_id,amount,result) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING result',
      [data.idempotencyKey, data.orderId, data.amount, JSON.stringify(result)],
    );
    if (stored.rows[0]) return stored.rows[0].result;
    const winner = await sql(
      'SELECT amount,order_id,result FROM payments WHERE idempotency_key=$1',
      [data.idempotencyKey],
    );
    if (winner.rows[0].amount !== data.amount || winner.rows[0].order_id !== data.orderId)
      return reply.code(409).send({ error: 'Idempotency key payload mismatch' });
    return ChargeResponse.parse(winner.rows[0].result);
  });
  await listen();
}
export async function gateway() {
  const { app, listen } = await server(8080);
  const breaker = new CircuitBreaker(
    {
      window: Number(process.env.BREAKER_WINDOW ?? breakerDefaults.window),
      minimum: Number(process.env.BREAKER_MINIMUM ?? breakerDefaults.minimum),
      threshold: Number(process.env.BREAKER_THRESHOLD ?? breakerDefaults.threshold),
      openMs: Number(process.env.BREAKER_OPEN_MS ?? breakerDefaults.openMs),
      probes: Number(process.env.BREAKER_PROBES ?? breakerDefaults.probes),
      requiredSuccesses: Number(
        process.env.BREAKER_REQUIRED_SUCCESSES ?? breakerDefaults.requiredSuccesses,
      ),
    },
    Date.now,
    (state) => {
      breakerGauge.set(state === 'closed' ? 0 : state === 'open' ? 1 : 2);
      void redis.set('breaker', state);
      void emit('breaker', `Payment circuit ${state}`, state === 'closed' ? 'info' : 'warn');
    },
  );
  await redis.set('breaker', 'closed');
  app.get('/api/products', async () => Product.array().parse(await call('catalog', '/products')));
  app.get<{ Params: { id: string } }>('/api/products/:id', (req) =>
    call('catalog', `/products/${CartId.parse(req.params.id)}`),
  );
  app.get('/api/cart', (req) => call('cart', `/cart/${CartId.parse(req.headers['x-cart-id'])}`));
  app.put('/api/cart', (req) =>
    call('cart', `/cart/${CartId.parse(req.headers['x-cart-id'])}`, {
      method: 'PUT',
      body: Cart.parse(req.body),
      idempotent: false,
    }),
  );
  app.post('/api/checkout', async (req, reply) => {
    const start = performance.now();
    const { cartId } = CheckoutRequest.parse(req.body);
    const key = CartId.parse(req.headers['idempotency-key'] ?? randomUUID());
    const existing = (await sql('SELECT id,status FROM orders WHERE idempotency_key=$1', [key]))
      .rows[0];
    if (existing)
      return CheckoutResponse.parse({
        status:
          existing.status === 'confirmed'
            ? 'confirmed'
            : existing.status === 'failed'
              ? 'failed'
              : 'queued',
        orderId: existing.id,
        latencyMs: performance.now() - start,
        attempts: 0,
        degraded: existing.status !== 'confirmed',
      });
    const spans: {
      service: string;
      offsetMs: number;
      durationMs: number;
      error: boolean;
      skipped?: boolean;
    }[] = [];
    async function step<T>(name: string, fn: () => Promise<T>) {
      const s = performance.now();
      let error = false;
      try {
        return await fn();
      } catch (e) {
        error = true;
        throw e;
      } finally {
        spans.push({
          service: name,
          offsetMs: s - start,
          durationMs: performance.now() - s,
          error,
        });
      }
    }
    const current = Cart.parse(await step('cart', () => call('cart', `/cart/${cartId}`)));
    if (!current.items.length)
      return reply.code(400).send({ error: 'Add a product before checkout' });
    const products = Product.array().parse(
      await step('catalog', () => call('catalog', '/products')),
    );
    let amount = 0;
    for (const item of current.items) {
      const p = products.find((p) => p.id === item.productId);
      if (!p) return reply.code(400).send({ error: 'Unknown product' });
      amount += p.price * item.quantity;
    }
    const orderId = randomUUID();
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const inserted = await sql(
      "INSERT INTO orders(id,idempotency_key,cart_id,amount,status,trace_context) VALUES($1,$2,$3,$4,'processing',$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",
      [orderId, key, cartId, amount, JSON.stringify(carrier)],
    );
    if (!inserted.rows.length)
      return reply
        .code(409)
        .send({ error: 'Checkout already processing; retry with the same key' });
    let attempts = 0;
    let status: 'confirmed' | 'queued' | 'failed' = 'queued';
    try {
      const charged = await step('payment', () =>
        breaker.execute(() =>
          call<unknown>('payment', '/charge', {
            method: 'POST',
            body: { orderId, amount, idempotencyKey: key },
            key,
            attempt: (n) => (attempts = n),
          }),
        ),
      );
      const result = ChargeResponse.parse(charged);
      status = result.status === 'approved' ? 'confirmed' : 'failed';
    } catch (error) {
      if (error instanceof CircuitOpenError)
        spans.push({
          service: 'payment',
          offsetMs: performance.now() - start,
          durationMs: 0,
          error: true,
          skipped: true,
        });
      else if (error instanceof HttpError && error.status < 500) status = 'failed';
      trace.getSpan(context.active())?.setStatus({ code: SpanStatusCode.ERROR });
    }
    await step('postgres', () =>
      sql('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1', [orderId, status]),
    );
    if (status === 'queued')
      await redis.xadd('orders.pending', '*', 'orderId', orderId, 'trace', JSON.stringify(carrier));
    if (status !== 'failed') await redis.del(`cart:${cartId}`);
    spans.unshift({
      service: 'gateway',
      offsetMs: 0,
      durationMs: performance.now() - start,
      error: status === 'failed',
    });
    await redis.set('latest.trace', JSON.stringify(spans), 'EX', 3600);
    await emit(
      'checkout',
      status === 'queued' ? 'Order queued safely; worker will retry payment' : `Order ${status}`,
      status === 'failed' ? 'warn' : 'info',
    );
    return CheckoutResponse.parse({
      status,
      orderId,
      latencyMs: performance.now() - start,
      attempts,
      degraded: status === 'queued',
    });
  });
  app.post('/api/chaos', async (req, reply) => {
    const { FaultRequest } = await import('../../../packages/common/src/schemas');
    const body = FaultRequest.parse(req.body);
    const { hashIp } = await import('./chaos');
    const owner = hashIp(req.ip);
    const response = await fetch(
      (process.env.CHAOS_CONTROLLER_URL ?? 'http://chaos-controller:8090') + '/v1/faults',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-visitor-hash': owner,
          'x-internal-token': process.env.INTERNAL_TOKEN ?? '',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    reply.code(response.status);
    return response.json();
  });
  app.get('/api/chaos/active', () => call('chaos-controller', '/v1/faults/active'));
  await listen();
}
