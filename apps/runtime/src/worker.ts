import { context, propagation, trace } from '@opentelemetry/api';
import { server, redis, sql, call, queueDepth, queueAge, emit } from './platform';
import { ChargeResponse } from '../../../packages/common/src/schemas';
import { sleep } from '../../../packages/common/src/resilience';
export async function worker() {
  const { listen } = await server(8084);
  await listen();
  const consumer = redis.duplicate();
  await redis.xgroup('CREATE', 'orders.pending', 'workers', '0', 'MKSTREAM').catch((e) => {
    if (!String(e).includes('BUSYGROUP')) throw e;
  });
  let stop = false;
  process.on('SIGTERM', () => {
    stop = true;
    consumer.disconnect();
  });
  async function processEntry(entry: [string, string[]]) {
    const [id, fields] = entry;
    const data = Object.fromEntries(
      Array.from({ length: fields.length / 2 }, (_, i) => [fields[i * 2], fields[i * 2 + 1]]),
    );
    const order = (await sql('SELECT * FROM orders WHERE id=$1', [data.orderId])).rows[0];
    if (!order || ['confirmed', 'failed'].includes(order.status)) {
      await redis.xack('orders.pending', 'workers', id);
      await redis.xdel('orders.pending', id);
      return;
    }
    if ((await redis.get('breaker')) === 'open') return;
    await context.with(propagation.extract(context.active(), JSON.parse(data.trace ?? '{}')), () =>
      trace.getTracer('order-worker').startActiveSpan('settle.queued-order', async (span) => {
        try {
          const result = ChargeResponse.parse(
            await call('payment', '/charge', {
              method: 'POST',
              body: {
                orderId: order.id,
                amount: order.amount,
                idempotencyKey: order.idempotency_key,
              },
              key: order.idempotency_key,
            }),
          );
          await sql('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1', [
            order.id,
            result.status === 'approved' ? 'confirmed' : 'failed',
          ]);
          await redis.xack('orders.pending', 'workers', id);
          await redis.xdel('orders.pending', id);
          await emit('order-settled', `Queued order ${result.status}`);
        } catch {
          const updated = await sql(
            'UPDATE orders SET attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING attempts',
            [order.id],
          );
          if (updated.rows[0].attempts >= 5) {
            await redis.xadd('orders.dead', '*', ...fields);
            await sql("UPDATE orders SET status='failed' WHERE id=$1", [order.id]);
            await redis.xack('orders.pending', 'workers', id);
            await redis.xdel('orders.pending', id);
            await emit('dead-letter', 'Order moved to dead-letter stream', 'error');
          } else await sleep(Math.min(10000, 500 * 2 ** updated.rows[0].attempts));
        } finally {
          span.end();
        }
      }),
    );
  }
  let reconcile = 0;
  while (!stop) {
    try {
      if (Date.now() - reconcile > 30000) {
        reconcile = Date.now();
        const lost = await sql(
          "SELECT id,trace_context FROM orders WHERE status IN ('queued','processing') AND updated_at < now()-interval '60 seconds'",
        );
        for (const o of lost.rows) {
          await redis.xadd(
            'orders.pending',
            '*',
            'orderId',
            o.id,
            'trace',
            JSON.stringify(o.trace_context),
          );
          await sql('UPDATE orders SET updated_at=now() WHERE id=$1', [o.id]);
        }
      }
      const claimed = (await consumer.xautoclaim(
        'orders.pending',
        'workers',
        'worker',
        10000,
        '0-0',
        'COUNT',
        10,
      )) as [string, [string, string[]][]];
      for (const entry of claimed[1]) await processEntry(entry);
      const batch = (await consumer.xreadgroup(
        'GROUP',
        'workers',
        'worker',
        'COUNT',
        10,
        'BLOCK',
        1000,
        'STREAMS',
        'orders.pending',
        '>',
      )) as [string, [string, string[]][]][] | null;
      for (const [, entries] of batch ?? []) for (const entry of entries) await processEntry(entry);
      queueDepth.set(await redis.xlen('orders.pending'));
      const oldest = await redis.xrange('orders.pending', '-', '+', 'COUNT', 1);
      queueAge.set(oldest[0] ? (Date.now() - Number(oldest[0][0].split('-')[0])) / 1000 : 0);
    } catch (error) {
      if (!stop) {
        console.error(error);
        await sleep(1000);
      }
    }
  }
}
