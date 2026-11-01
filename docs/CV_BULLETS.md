# CV bullets — verified scope

- Built a TypeScript resilience lab with independently deployed Fastify services, React, Postgres, Redis Streams and a simulated payment processor.
- Implemented circuit breakers, jittered retries, bulkheads and idempotent durable checkout; verified real service faults with Compose integration and k3d browser tests.
- Instrumented requests with OpenTelemetry and Prometheus, streamed local live state over SSE and deployed a clearly labelled recording-based public dashboard on GitHub Pages.
- Demonstrated CPU-driven Kubernetes autoscaling and automated capture of timestamped fault experiments, including topology, events, checkout timings and normalized traces.

For measured recovery statistics and sample counts, cite docs/benchmarks/REPORT.md after the recording campaign finishes. These are shared-workstation experiments, not production throughput or availability claims. Do not claim forty completed runs until full validation passes.
