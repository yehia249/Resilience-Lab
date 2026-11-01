# Status

## Current state
- M0 scaffold implemented: strict TypeScript/pnpm workspace, formatting/lint, shared schemas, test runner and CI definitions. Initial plan pushed to the requested repository. Feature work is on feat/resilience-lab while runtime verification continues.
- M1/M2 implemented: independent Fastify processes, seeded SQL catalog, Redis carts, idempotent charges, breaker/retry/bulkhead, queued orders and reconciliation worker. Integration verification is in progress; not yet declared complete.
- M3/M4 implemented: service metrics, OTel, collector/Prometheus/Jaeger, SSE snapshots, recovery persistence and four bounded real fault adapters. Runtime sequence tests remain pending.
- M5 implemented: responsive dark/light React dashboard, shop, waterfall, engineering page, offline states and measured-only benchmarks. Browser navigation/accessibility/mobile offline test passed; connected UI tests pending.
- M6 implemented: generated Kubernetes manifests, HPA, probes, resource budgets, default-deny policies and payment-namespace kill proxy. k3d and HPA proof pending.
- M7 implemented: OCI Terraform, local saved-plan approval script and gated GitHub deployment workflow. Terraform initialization and validation pass. No cloud plan/apply attempted.
- M8 pending: public hosting, full fault/load benchmarks, Lighthouse, live smoke and personal demo recording.

## Local environment
- Created isolated ResilienceLab WSL 2 distribution because no Linux distro or Docker existed; installed Docker Engine/Compose, kubectl, k3d and Terraform there.
- Initial image build completed. First startup exceeded Postgres initialization allowance; Postgres subsequently became healthy. Increased startup grace and reduced runtime image contents. Rebuild in progress.
- WSL gateway DNS failed during rebuild; isolated distro DNS repaired and Docker registry connectivity verified.
- User confirmed no Oracle account, no spare host, and no prototype file. Screenshot/spec are the reference. Cloud signup and resource-plan approval are deferred until local work is ready.

## Measured results
- Unit: 9 tests pass (breaker transitions, retry, bulkhead, recovery, schema contracts).
- Lint and strict typecheck pass after dependency updates.
- Playwright offline dashboard/engineering navigation, axe WCAG A/AA and 390-pixel no-overflow test: pass. Initial light-theme contrast failures fixed and retested.
- Frontend production JS after security updates: 80.17 KB gzip; CSS 3.85 KB gzip. Build artifact measurement, not a runtime performance benchmark.
- Dependency audit: 0 high/critical, 3 moderate remaining at latest check. No claim of zero vulnerabilities.
- Terraform validate: success. Generated 98 Kubernetes resources; not yet cluster-validated.
- Runtime throughput/recovery/HPA benchmarks: none published yet. results.json remains explicitly not_run.
