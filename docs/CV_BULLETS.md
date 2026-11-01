# CV bullets — evidence only

- Built a TypeScript resilience lab with independently deployed Fastify services, React, Postgres, Redis Streams and an explicitly simulated payment processor.
- Implemented a custom circuit breaker, jittered retry policy, concurrency bulkheads and idempotent queued checkout; link to the repository tests and verification evidence.
- Instrumented service traffic with OpenTelemetry and Prometheus and streamed live operational state to a public dashboard over SSE.
- Kubernetes recovery: [measured duration pending]; sustained throughput: [measured load test pending]; p95 latency: [measured target pending]. Do not replace these placeholders with estimates.

Only add deployment, autoscaling and fault-recovery claims after the corresponding checks in STATUS.md pass. Test counts and bundle sizes are engineering verification, not production performance benchmarks.
