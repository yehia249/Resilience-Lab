import { randomUUID } from 'node:crypto';
import { server, redis } from './platform';
import { Product } from '../../../packages/common/src/schemas';
export async function traffic() {
  const { app, listen } = await server(8091);
  const base = process.env.GATEWAY_URL ?? 'http://gateway:8080';
  let inFlight = 0;
  let tokens = 0;
  let windowStart=Date.now();let windowRequests=0;
  const baseline = Math.min(40, Math.max(5, Number(process.env.BASELINE_RPS ?? 25)));
  let spike = false;
  const update = setInterval(() => {
    void redis
      .exists('fault:SPIKE_TRAFFIC')
      .then((n) => (spike = n === 1))
      .catch(() => {});
  }, 500);
  async function request(path: string, method = 'GET', body?: unknown, cartId?: string) {
    if(Date.now()-windowStart>=1000){windowStart=Date.now();windowRequests=0;}
    if (tokens < 1 || windowRequests>=150) return null;
    tokens--;
    windowRequests++;
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-cart-id': cartId ?? randomUUID(),
        'idempotency-key': randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? res.json() : null;
  }
  async function shopper() {
    inFlight++;
    try {
      const data = await request('/api/products');
      const parsed = Product.array().safeParse(data);
      if (!parsed.success) return;
      const products = parsed.data
        .sort(() => Math.random() - 0.5)
        .slice(0, 3 + Math.floor(Math.random() * 4));
      for (const p of products) await request(`/api/products/${p.id}`);
      const id = randomUUID();
      await request(
        '/api/cart',
        'PUT',
        { items: products.slice(0, 2).map((p) => ({ productId: p.id, quantity: 1 })) },
        id,
      );
      if (Math.random() < 0.4) await request('/api/checkout', 'POST', { cartId: id }, id);
    } catch (error) {
      app.log.debug(error);
    } finally {
      inFlight--;
    }
  }
  // Token budget applies to every outgoing request, not just shopper sessions.
  const ticker = setInterval(() => {
    const rps = Math.min(150, baseline * (spike ? 5 : 1));
    tokens = Math.min(75, tokens + rps / 10);
    while (inFlight < 25 && tokens >= 8) void shopper();
  }, 100);
  app.addHook('onClose', async () => {
    clearInterval(ticker);
    clearInterval(update);
  });
  await listen();
}
