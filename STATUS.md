# Delivery status

Updated 2026-11-01. Scope is local Docker Compose + k3d and public recorded replay on GitHub Pages. No cloud infrastructure or account setup.

Verified:

- Separate real services, durable Postgres orders, Redis Streams, bounded faults and OpenTelemetry/Prometheus.
- Compose smoke and all four fault integration checks; measured output in docs/benchmarks/integration.json.
- Local k3d smoke, real HPA scaling and payment-kill/recovery browser checks.
- CI at a44f4f1 passed source, security, Compose and k3d jobs.
- Replay browser test passed: all four fault mappings, captured checkout, zero backend calls, responsive layout and axe accessibility in both themes.
- Real recording campaign is running; docs/benchmarks/results.json is the current measured count and summary.

Remaining:

- Finish ten real captures per fault and validate the full dataset.
- Publish and verify the Pages workflow for the new replay implementation.
- Verify CI again for the latest replay and runtime image changes.

No full benchmark completion, live public backend or cloud deployment is claimed. Runtime provenance is recorded separately from recorder source revision.
