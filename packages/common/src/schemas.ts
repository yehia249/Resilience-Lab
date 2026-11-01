import { z } from 'zod';
export const FaultType = z.enum([
  'KILL_PAYMENT',
  'ADD_CATALOG_LATENCY',
  'SPIKE_TRAFFIC',
  'SLOW_DATABASE',
]);
export type FaultType = z.infer<typeof FaultType>;
export const FaultRequest = z.object({ type: FaultType }).strict();
export const Product = z.object({
  id: z.string().uuid(),
  name: z.string(),
  price: z.number().int().nonnegative(),
  icon: z.string(),
});
export type Product = z.infer<typeof Product>;
export const CartItem = z
  .object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })
  .strict();
export const Cart = z.object({ items: z.array(CartItem).max(24) }).strict();
export type Cart = z.infer<typeof Cart>;
export const CartId = z.string().uuid();
export const CheckoutRequest = z.object({ cartId: CartId }).strict();
export const ChargeRequest = z
  .object({
    orderId: z.string().uuid(),
    amount: z.number().int().positive(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const ChargeResponse = z.object({
  status: z.enum(['approved', 'declined']),
  idempotencyKey: z.string().uuid(),
});
export const CheckoutResponse = z.object({
  status: z.enum(['confirmed', 'queued', 'failed']),
  orderId: z.string().uuid(),
  latencyMs: z.number().nonnegative(),
  attempts: z.number().int(),
  degraded: z.boolean(),
});
export const Event = z.object({
  ts: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  kind: z.string(),
  message: z.string(),
});
export type LabEvent = z.infer<typeof Event>;
export const Span = z.object({
  service: z.string(),
  offsetMs: z.number(),
  durationMs: z.number(),
  error: z.boolean(),
  skipped: z.boolean().optional(),
});
export const Fault = z.object({
  id: z.string().uuid(),
  type: FaultType,
  startedAt: z.number(),
  expiresAt: z.number(),
  owner: z.string(),
});
export type ActiveFault = z.infer<typeof Fault>;
export const Service = z.object({
  name: z.string(),
  ready: z.number().nullable(),
  desired: z.number().nullable(),
  cpuPct: z.number().nullable(),
  memoryBytes: z.number().nullable(),
  p95: z.number().nullable(),
  state: z.enum(['healthy', 'degraded', 'down', 'unknown']),
});
export const Metrics = z.object({
  rps: z.number().nullable(),
  errorRatePct: z.number().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
});
export type LabMetrics = z.infer<typeof Metrics>;
export const Recovery = z.object({
  fault_type: FaultType,
  duration: z.number(),
  peak_p95: z.number(),
  peak_error_rate: z.number(),
  created_at: z.string(),
});
export const Snapshot = z.object({
  ts: z.number(),
  metrics: Metrics,
  services: z.array(Service),
  breaker: z.enum(['closed', 'open', 'half-open']),
  fault: Fault.nullable(),
  cooldownUntil: z.number(),
  chaosEnabled: z.boolean(),
  events: z.array(Event),
  trace: z.array(Span),
  recoveries: z.array(Recovery),
  source: z.literal('live'),
});
export type Snapshot = z.infer<typeof Snapshot>;
export const BenchmarkResults = z.object({
  status: z.enum(['not_run', 'measured']),
  runs: z.array(
    z.object({
      type: FaultType,
      duration: z.number(),
      peakP95: z.number(),
      peakErrorRate: z.number(),
    }),
  ),
  measuredAt: z.string().nullable(),
  target: z.string().nullable(),
});
export const StreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), data: Snapshot }),
  z.object({ type: z.literal('metrics'), data: Metrics }),
  z.object({
    type: z.literal('topology'),
    data: z.object({ services: z.array(Service), breaker: Snapshot.shape.breaker }),
  }),
  z.object({ type: z.literal('event'), data: Event }),
  z.object({ type: z.literal('trace'), data: z.array(Span) }),
  z.object({
    type: z.literal('fault'),
    data: z.object({
      active: Fault.nullable(),
      cooldownUntil: z.number(),
      chaosEnabled: z.boolean(),
    }),
  }),
]);
