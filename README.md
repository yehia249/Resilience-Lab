# Resilience Lab

A small shop you can break: real HTTP services, Postgres, Redis Streams, circuit breakers, bounded faults, Kubernetes autoscaling and measured recovery.

**[Public recorded dashboard](https://yehia249.github.io/Resilience-Lab/)** · [Verification](STATUS.md) · [Measured recordings](docs/benchmarks/REPORT.md)

The public frontend defaults to **Replay**. Each fault button selects an actual local recording. Metrics, topology, checkout results, traces and events come from those captures. The banner identifies the capture date; replay never sends transactions or faults to a backend. Missing data stays unavailable. The index reports completed runs; the target is ten per fault.

Live mode runs entirely on your machine. No cloud account, card, external backend or signup is required. The payment processor is explicitly simulated; HTTP calls, SQL, queues, faults and timings are real.

## Run locally

Prerequisites: Node 20+, pnpm 10.20, Docker with Compose; bash, Make, kubectl and k3d for Kubernetes. This Windows workstation's isolated ResilienceLab WSL distribution already contains the Linux tools.

```sh
pnpm install --frozen-lockfile
make dev                 # ignored secrets; build and start Compose
make smoke               # actual products, cart, checkout and telemetry
make test                # lint, types, unit tests and build
make k3d-up              # local Kubernetes, HPA and dashboard on :8089
```

Compose: http://localhost:8088. Kubernetes: http://localhost:8089. Compose has fixed replicas; actual autoscaling uses k3d. See [operation and Pages delivery](docs/DEPLOY.md) and the [runbook](docs/RUNBOOK.md).

## Reproduce recordings

```sh
# Keep k3d running. In another terminal:
kubectl port-forward -n lab service/jaeger 16687:16686
make record
REQUIRE_FULL_RECORDINGS=true pnpm exec tsx scripts/validate-recordings.ts
```

The recorder targets the named local cluster, runs four faults ten times each and resumes completed runs. It resets the local fixture's visitor quota; fault TTL, exclusion, cooldown and recovery checks remain enforced. Actual JSON is duplicated under docs/benchmarks/recordings/ and apps/web/public/recordings/. The report derives statistics only from completed measurements. Capture takes real wall time and is affected by other work on this machine.

## Verify and publish

```sh
pnpm exec playwright install chromium
pnpm test:e2e
RUN_K8S_E2E=true BASE_URL=http://localhost:8089 pnpm test:e2e
VITE_LAB_MODE=replay VITE_SITE_BASE=/Resilience-Lab/ pnpm build
RUN_REPLAY_E2E=true BASE_URL=http://127.0.0.1:4173/Resilience-Lab/ pnpm exec playwright test e2e/replay.spec.ts
```

GitHub Actions checks source, secrets, containers, Compose and k3d. The Pages workflow validates recordings, builds the static frontend, tests replay without backend calls, and publishes to GitHub Pages. No cloud infrastructure is provisioned.

## Engineering

React 18, Vite, strict TypeScript, Fastify, zod contracts, Postgres 16, Redis 7/Streams, tested retry/breaker/bulkhead, OpenTelemetry, Prometheus, Jaeger, Docker, k3s/k3d, Kustomize and GitHub Actions. Separate service processes share middleware in apps/runtime.

Read the [architecture](docs/ARCHITECTURE.md), [ADRs](docs/adr), [threat model](docs/THREAT_MODEL.md), [cost boundary](docs/COST.md), [demo script](docs/DEMO_SCRIPT.md) and [CV bullets](docs/CV_BULLETS.md). Single-node service recovery does not provide host-level high availability.
