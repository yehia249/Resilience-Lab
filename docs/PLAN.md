# Project plan

Build the real Resilience Lab in milestones M0–M8. The screenshot is the visual reference until the missing prototype is supplied. No invented telemetry or benchmark numbers; unavailable measurements display unavailable.

## Milestones
- M0: pnpm/TypeScript workspace, lint, tests, CI skeleton, documentation.
- M1: Fastify services, Postgres, Redis, working shop, containers, load generator.
- M2: tested breaker/retry/bulkhead, idempotency, queued orders and worker.
- M3: OpenTelemetry, Prometheus, Jaeger, telemetry SSE and recovery persistence.
- M4: bounded chaos faults with TTL, cooldown, rate limit and local/Kubernetes adapters.
- M5: React dashboard and engineering page, responsive/accessibility verification.
- M6: Kubernetes, HPA, policies, RBAC, local cluster validation.
- M7: Terraform and gated delivery; require resource-plan approval before apply.
- M8: public deployment, measured fault/load benchmarks, demo script, final verification.

## Constraints and assumptions
- Public repository: https://github.com/yehia249/Resilience-Lab.
- Zero cloud spend; no paid resources, payment methods or upgrades.
- OCI credentials and first apply approval are human-only. Never commit secrets.
- Windows workstation initially has Git, Node, Python and WSL; Docker, pnpm, kubectl, k3d, Terraform and gh are not on PATH.
- Public production hosting cannot be claimed until a backend host and account access exist.
- Payment processor is explicitly simulated; infrastructure, faults and measurements must be real.

## Risks and open questions
- Prototype file absent: requested once; screenshot is sufficient to proceed.
- Oracle account, free ARM capacity and SSH access unknown. No cloud apply is authorized yet.
- Docker/WSL availability must be inspected before integration and cluster tests.
- Always Free eligibility must be checked against current Oracle documentation.
- Long load/benchmark runs require a healthy target; do not replace missing runs with generated data.
