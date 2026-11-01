# Delivery status

Updated 2026-11-01. The backend runs locally; the public frontend is clearly labelled Replay on GitHub Pages. No cloud account or infrastructure is required.

| Milestone                                             | Delivery                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M0–M1: workspace, contracts and resilience primitives | TypeScript monorepo, shared zod schemas, tested breaker/retry/bulkhead/recovery                           |
| M2–M4: real services, observability and faults        | Postgres, Redis Streams, idempotent durable orders, bounded fault controller, Prometheus, OTel and Jaeger |
| M5: dashboard                                         | Live and Replay, responsive light/dark UI, service map, chart, waterfall, shop, events and recovery       |
| M6: local Kubernetes                                  | k3d, HPA, narrow fault RBAC, network policies, readiness and recovery checks                              |
| M7: cloud                                             | Removed at the user's request                                                                             |
| M8: measurements and public frontend                  | At least 40 actual captures, measured load tests, GitHub Pages workflow, reports and walkthrough          |

Public site: https://yehia249.github.io/Resilience-Lab/. Source: https://github.com/yehia249/Resilience-Lab.

Evidence:

- The recording indexes contain actual capture counts. Full validation requires at least ten runs per fault and checks public files against the raw evidence.
- docs/benchmarks/REPORT.md and analysis.json derive fault statistics from the saved runs.
- docs/benchmarks/load/ contains completed baseline, spike and one-hour soak outputs with separate CI provenance. The soak recorded 90,000 catalog requests, zero HTTP failures and 23.884 ms p95.
- docs/benchmarks/local-smoke-latest.json contains actual local shop/SSE/trace verification. Historical and later runtime artifacts are distinguished in PROVENANCE.md.
- Lighthouse reports retain measured desktop results, including earlier slower runs. They measure the static public frontend.

[CI runs](https://github.com/yehia249/Resilience-Lab/actions) identify exact tested commits. Gates include lint, types, 12 unit/contract tests, dependency/secret/container scans, Compose fault/queue/idempotency checks, k3d recovery/HPA E2E and Kubernetes schema validation. Pages separately validates the complete dataset and browser-tests Replay with no backend calls.

Historical measurements are never relabelled as a newer build. The payment processor is simulated; requests, SQL, queues, faults and captured timings are real. A single local node provides no host-level high availability.
