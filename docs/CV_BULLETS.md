# CV bullets — measured scope

- Built a TypeScript resilience lab with independently deployed Fastify services, Postgres, Redis Streams, React and a simulated payment processor.
- Implemented circuit breakers, jittered retries, bulkheads and idempotent durable checkout; verified queue settlement, stream replay and bounded fault controls against real services.
- Captured at least 40 actual local fault experiments with metrics, topology, events and traces; published a clearly labelled Replay dashboard on GitHub Pages with local Live mode.
- Measured a one-hour Compose catalog load at 25 requests/s: 90,000 requests, zero HTTP failures and 23.9 ms p95 in the documented GitHub CI environment.

Link the repository and raw evidence. The load figure describes catalog HTTP requests in that environment, not payment throughput or production availability. Fault-recovery medians and runtime provenance are in docs/benchmarks/REPORT.md and PROVENANCE.md.
