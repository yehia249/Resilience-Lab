# Delivery status

Updated 2026-11-01. Scope is local Docker Compose + k3d and public recorded replay on GitHub Pages. No cloud infrastructure or account setup.

Verified:

- Separate real services, durable Postgres orders, Redis Streams, bounded faults and OpenTelemetry/Prometheus.
- Compose smoke and all four fault integration checks; measured output in docs/benchmarks/integration.json.
- Local k3d smoke, real HPA scaling and payment-kill/recovery browser checks.
- CI at e35f7d9 passed source, both container scans, Compose integration, k3d recovery/HPA E2E and Kubernetes schema validation.
- Replay browser test passed: all four fault mappings, captured checkout, zero backend calls, responsive layout and axe accessibility in both themes.
- Published Pages replay passed the browser test against the public URL.
- Desktop Lighthouse: 94 Performance, 99 Accessibility; raw HTML and JSON reports in docs/benchmarks/.
- Real recording campaign is running; docs/benchmarks/results.json is the current measured count and summary.

Remaining:

- Finish ten real captures per fault and validate the full dataset.
- Collect baseline/spike/one-hour soak results from the isolated Compose CI run.
- Verify CI again for the latest replay and runtime image changes.

No full benchmark completion, live public backend or cloud deployment is claimed. Runtime provenance is recorded separately from recorder source revision.
