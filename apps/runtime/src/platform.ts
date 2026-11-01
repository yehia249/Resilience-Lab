import Redis from 'ioredis';
import pg from 'pg';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID,createHmac } from 'node:crypto';
import { Bulkhead, retry, sleep } from '../../../packages/common/src/resilience';
import type { LabEvent } from '../../../packages/common/src/schemas';
export const service = process.env.SERVICE ?? 'gateway';
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://lab:lab@localhost:5432/lab',
  max: 5,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
export const registry = new Registry();
collectDefaultMetrics({ register: registry });
export const duration = new Histogram({
  name: 'http_server_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 0.8, 1, 1.5, 2, 5],
  registers: [registry],
});
export const breakerGauge = new Gauge({
  name: 'breaker_state',
  help: '0 closed, 1 open, 2 half-open',
  registers: [registry],
});
export const downstream = new Counter({
  name: 'downstream_calls_total',
  help: 'Downstream attempts',
  labelNames: ['target', 'outcome'],
  registers: [registry],
});
export const retries = new Counter({
  name: 'retries_total',
  help: 'Additional downstream attempts',
  registers: [registry],
});
export const rejections = new Counter({
  name: 'bulkhead_rejections_total',
  help: 'Rejected concurrent calls',
  registers: [registry],
});
export const queueDepth = new Gauge({
  name: 'orders_queue_depth',
  help: 'Pending stream entries',
  registers: [registry],
});
export const queueAge = new Gauge({
  name: 'orders_queue_oldest_age_seconds',
  help: 'Age of oldest pending order',
  registers: [registry],
});
export const faultGauge = new Gauge({
  name: 'fault_active',
  help: 'Active bounded fault',
  labelNames: ['type'],
  registers: [registry],
});
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  query: string,
  args: unknown[] = [],
) {
  if (['catalog', 'payment'].includes(service) && (await redis.exists('fault:SLOW_DATABASE')))
    await sleep(250);
  return db.query<T>(query, args);
}
export async function emit(kind: string, message: string, level: LabEvent['level'] = 'info') {
  const event: LabEvent = { ts: Date.now(), kind, message, level };
  await redis
    .multi()
    .lpush('events', JSON.stringify(event))
    .ltrim('events', 0, 49)
    .publish('lab.events', JSON.stringify(event))
    .exec();
  return event;
}
const bulkheads = new Map<string, Bulkhead>();
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function call<T>(
  target: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    idempotent?: boolean;
    key?: string;
    attempt?: (n: number) => void;
  } = {},
): Promise<T> {
  let bulkhead = bulkheads.get(target);
  if (!bulkhead) {
    bulkhead = new Bulkhead(Number(process.env.BULKHEAD_LIMIT ?? 50));
    bulkheads.set(target, bulkhead);
  }
  const timeout = Number(
    process.env[`${target.toUpperCase()}_TIMEOUT_MS`] ?? (target === 'payment' ? 1500 : 800),
  );
  const ports: Record<string, number> = {
    gateway: 8080,
    catalog: 8081,
    cart: 8082,
    payment: 8083,
    'chaos-controller': 8090,
    'telemetry-api': 8095,
  };
  const url =
    process.env[`${target.toUpperCase().replaceAll('-', '_')}_URL`] ??
    `http://${target}:${ports[target]}`;
  try {
    return await bulkhead.run(() =>
      retry(
        async (attempt) => {
          options.attempt?.(attempt);
          if (attempt > 1) retries.inc();
          return trace.getTracer(service).startActiveSpan(`downstream.${target}`, async (span) => {
            try {
              const headers: Record<string, string> = { 'content-type': 'application/json' };
              propagation.inject(context.active(), headers);
              if (options.key) headers['idempotency-key'] = options.key;
              const response = await fetch(url + path, {
                method: options.method ?? 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: AbortSignal.timeout(timeout),
              });
              if (!response.ok)
                throw new HttpError(response.status, `${target} returned ${response.status}`);
              downstream.inc({ target, outcome: 'success' });
              return (await response.json()) as T;
            } catch (error) {
              downstream.inc({ target, outcome: 'error' });
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
            }
          });
        },
        {
          retries: options.key
            ? Number(process.env.PAYMENT_RETRIES ?? 1)
            : options.idempotent === false
              ? 0
              : Number(process.env.GET_RETRIES ?? 2),
          baseMs: Number(process.env.RETRY_BASE_MS ?? 100),
          retryable: (error) => !(error instanceof HttpError) || error.status >= 500,
        },
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Bulkhead full') rejections.inc();
    throw error;
  }
}
export async function server(port: number) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service },
      redact: ['req.headers.authorization', 'req.headers.x-admin-token'],
    },
    bodyLimit: 16384,
    requestTimeout: 10000,
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
    trustProxy: process.env.TRUST_PROXY === 'true' ? (_address: string, hop: number) => hop < 1 : false,
  });
  await app.register(cors, {
    origin: process.env.SITE_ORIGIN ?? 'http://localhost:5173',
    allowedHeaders: ['content-type', 'x-cart-id', 'idempotency-key'],
    exposedHeaders: ['x-trace-id'],
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    max: service === 'gateway' ? 10000 : 15000,
    timeWindow: 60000,
    redis,
    keyGenerator: req => createHmac('sha256',process.env.IP_HASH_SECRET??'local-only').update(`${Math.floor(Date.now()/86400000)}:${req.ip}`).digest('hex'),
  });
  const started = new WeakMap<object, number>();
  app.addHook('onRequest', async (req, reply) => {
    started.set(req, performance.now());
    reply.header('x-trace-id', trace.getSpan(context.active())?.spanContext().traceId ?? req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    if (!['/metrics', '/healthz', '/readyz'].includes(req.url)) {
      duration.observe(
        { route: req.routeOptions.url ?? 'unmatched', status: reply.statusCode },
        (performance.now() - (started.get(req) ?? performance.now())) / 1000,
      );
      app.log.info(
        {
          traceId: trace.getSpan(context.active())?.spanContext().traceId,
          route: req.routeOptions.url,
          status: reply.statusCode,
        },
        'request complete',
      );
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?: number };
    reply
      .code(e.name === 'ZodError' ? 400 : (e.statusCode ?? 503))
      .send({ error: e.name === 'ZodError' ? 'Invalid request' : e.message });
  });
  app.get('/healthz', {config:{rateLimit:false}}, () => ({ status: 'ok', service }));
  app.get('/readyz', {config:{rateLimit:false}}, async () => {
    await Promise.all([redis.ping(), db.query('SELECT 1')]);
    return { status: 'ready' };
  });
  app.get('/metrics', {config:{rateLimit:false}}, async (_req, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
  app.addHook('onClose', async () => {
    await redis.quit();
    await db.end();
  });
  process.on('SIGTERM', () => {
    void app.close();
  });
  return { app, listen: () => app.listen({ port, host: '0.0.0.0' }) };
}
