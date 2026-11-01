# Ten difficult questions

1. **Is the payment real?** The processor's latency/decline behavior is explicitly simulated. Its HTTP process, failure, DB idempotency, retries and observed timings are real. No payment network or money is involved.
2. **Exactly once?** No. Streams and SQL reconciliation provide at-least-once delivery. The unique idempotency key prevents duplicate charge effects; consumers recheck durable order status.
3. **What if Redis publication fails after SQL commit?** SQL retains the queued/processing order. The worker periodically republishes stale pending records. Duplicate stream entries are safe but may temporarily increase queue depth.
4. **What if a charge succeeds but its HTTP response is lost?** Retry uses the same order, amount and key. The processor returns the committed result. It rejects the same key with a different order or amount.
5. **Why a 50% breaker threshold?** It is an explicit initial policy, not a measured optimum. Minimum ten samples prevent opening on a single decline; declines are business outcomes and do not count as transport failures. Tune with fault data.
6. **Are breakers shared across gateway pods?** No; call windows are per gateway instance. Prometheus aggregates the visible state. Each process has its own retry and bulkhead budgets, so total concurrency grows with replicas.
7. **Can Kubernetes RBAC delete only a label?** No. The payment deployment is isolated in its own namespace and a fixed-function proxy additionally validates labels. Claiming a label-restricted Role would be misleading.
8. **Does HPA save a failing database?** No. Scaling application pods may increase database pressure. Fixed per-process pools, limits and capacity planning matter. A two-core single host cannot create extra CPU by adding pods.
9. **What does recovery mean?** Ten consecutive measured samples below 2% HTTP server errors and 250-ms p95, after fault clearance, with ready replicas. It is a chosen SLO-like lab definition, not proof of all business operations settling.
10. **What fails outside the demo?** A single-node host or disk failure takes everything down. There are no cross-zone replicas or verified off-host backups. Local disk or power failure and CI supply-chain updates remain operational risks.
