import { z } from 'zod';
import { FaultType, Snapshot, Product, CheckoutResponse, Span } from './schemas';
export const RecordedCheckout = z.object({
  ts: z.number(),
  traceId: z.string().nullable(),
  result: CheckoutResponse,
});
export const RecordedTrace = z.object({
  traceId: z.string(),
  spans: z.array(Span.extend({ operation: z.string().optional() })),
});
export const Recording = z.object({
  version: z.literal(1),
  id: z.string(),
  type: FaultType,
  environment: z.literal('k3d'),
  capturedAt: z.iso.datetime(),
  source: z.literal('real-local-system'),
  faultStartedAt: z.number(),
  recoverySeconds: z.number().nonnegative(),
  peakP95: z.number().nonnegative(),
  peakErrorRate: z.number().nonnegative(),
  baselineRps: z.number().nonnegative(),
  maxRps: z.number().nonnegative(),
  runtime: z.object({
    imageDigest: z.string(),
    recorderRevision: z.string(),
    nodeVersion: z.string(),
    notes: z.string(),
  }),
  products: z.array(Product),
  frames: z.array(Snapshot).min(2),
  checkouts: z.array(RecordedCheckout),
  traces: z.array(RecordedTrace).min(1),
  collectionErrors: z.array(z.object({ ts: z.number(), message: z.string() })),
});
export type Recording = z.infer<typeof Recording>;
export const RecordingSummary = Recording.pick({
  id: true,
  type: true,
  environment: true,
  capturedAt: true,
  recoverySeconds: true,
  peakP95: true,
  peakErrorRate: true,
  baselineRps: true,
  maxRps: true,
}).extend({ file: z.string().regex(/^recordings\/[A-Za-z0-9_-]+\.json$/) });
export type RecordingSummary = z.infer<typeof RecordingSummary>;
export const RecordingIndex = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  expectedRuns: z.number().int().positive(),
  runs: z.array(RecordingSummary),
});
export type RecordingIndex = z.infer<typeof RecordingIndex>;
